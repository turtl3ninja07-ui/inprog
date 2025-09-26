import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';

type Stats = {
  today: number;
  d7: number;
  d30: number;
};

type BlockedIp = {
  ip: string;
  reason: string | null;
  created_at: string;
};

type AdminVerifyResponse = {
  ok: boolean;
  isAdmin: boolean;
  email?: string;
  requestId?: string;
  message?: string;
  error?: string;
};

type AdminAction =
  | { action: 'verify' }
  | { action: 'stats' }
  | { action: 'accounts' }
  | { action: 'reset_leaderboard' }
  | { action: 'clear_abuse' }
  | { action: 'list_blocked_ips' }
  | { action: 'block_ip'; ip: string; reason?: string }
  | { action: 'unblock_ip'; ip: string };

const FN_URL = 'https://wblnwqqsbobcdjllrhum.supabase.co/functions/v1/app_6571a533ec_admin';

async function callAdmin<T = unknown>(payload: AdminAction): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } as Record<string, string>,
    body: JSON.stringify(payload),
  });
  const json: unknown = await res.json().catch(() => ({} as unknown));
  if (!res.ok) {
    let msg = 'Request failed';
    if (typeof json === 'object' && json !== null) {
      const obj = json as { error?: unknown; message?: unknown };
      if (typeof obj.error === 'string') msg = obj.error;
      else if (typeof obj.message === 'string') msg = obj.message;
    }
    throw new Error(msg);
  }
  return json as T;
}

export default function AdminPanel() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [email, setEmail] = useState<string | undefined>(undefined);

  const [stats, setStats] = useState<Stats>({ today: 0, d7: 0, d30: 0 });
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [accountsError, setAccountsError] = useState<string>('');
  const [blocked, setBlocked] = useState<BlockedIp[]>([]);
  const [ipToBlock, setIpToBlock] = useState('');
  const [reason, setReason] = useState('');

  const signedIn = useMemo(() => !!email, [email]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const verify = await callAdmin<AdminVerifyResponse>({ action: 'verify' });
        setIsAdmin(!!verify.isAdmin);
        setEmail(verify.email);
        if (verify.isAdmin) {
          await Promise.all([refreshStats(), refreshBlocked(), refreshAccounts()]);
        }
      } catch (e) {
        console.error(e);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function refreshStats() {
    const data = await callAdmin<{ ok: boolean; stats: Stats }>({ action: 'stats' });
    if (data?.ok && data.stats) setStats(data.stats);
  }

  async function refreshAccounts() {
    try {
      setAccountsError('');
      const data = await callAdmin<{ ok: boolean; count: number }>({ action: 'accounts' });
      if (data?.ok && typeof data.count === 'number') setAccountsCount(data.count);
      else setAccountsError('Failed to load accounts count.');
    } catch (e) {
      setAccountsError((e as Error).message || 'Failed to load accounts count.');
    }
  }

  async function refreshBlocked() {
    const data = await callAdmin<{ ok: boolean; items: BlockedIp[] }>({ action: 'list_blocked_ips' });
    if (data?.ok && data.items) setBlocked(data.items);
  }

  async function doResetLeaderboard() {
    if (!confirm('This will clear counts and click events. Continue?')) return;
    const r = await callAdmin<{ ok: boolean; cleared: string[] }>({ action: 'reset_leaderboard' });
    if (r.ok) {
      await Promise.all([refreshStats(), refreshBlocked()]);
      alert('Leaderboard reset complete.');
    }
  }

  async function doClearAbuse() {
    if (!confirm('This will delete click events for blocked IPs. Continue?')) return;
    const r = await callAdmin<{ ok: boolean; deleted: number }>({ action: 'clear_abuse' });
    if (r.ok) {
      await refreshStats();
      alert(`Cleared ${r.deleted} abusive events.`);
    }
  }

  async function doBlockIp() {
    if (!ipToBlock) {
      alert('Enter an IP to block.');
      return;
    }
    const r = await callAdmin<{ ok: boolean }>({ action: 'block_ip', ip: ipToBlock.trim(), reason: reason.trim() || undefined });
    if (r.ok) {
      setIpToBlock('');
      setReason('');
      await refreshBlocked();
      alert('IP blocked.');
    }
  }

  async function doUnblockIp(ip: string) {
    const r = await callAdmin<{ ok: boolean }>({ action: 'unblock_ip', ip });
    if (r.ok) {
      await refreshBlocked();
      alert('IP unblocked.');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Checking admin access...</div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Please sign in first. Open the menu and use "Login / Sign up". Then return to this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your account ({email}) is not authorized for admin access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">Admin Panel</h1>
          <Button variant="secondary" onClick={() => window.history.back()}>Back</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Traffic & Accounts</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Today</div>
              <div className="text-3xl font-bold">{stats.today}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Last 7 days</div>
              <div className="text-3xl font-bold">{stats.d7}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Last 30 days</div>
              <div className="text-3xl font-bold">{stats.d30}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Accounts Created</div>
                  <div className="text-3xl font-bold">{accountsCount}</div>
                </div>
                <Button variant="outline" size="sm" onClick={refreshAccounts}>Refresh</Button>
              </div>
              {accountsError && <div className="mt-2 text-xs text-red-300">{accountsError}</div>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Moderation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="grid flex-1 gap-2">
                <Label htmlFor="ip">IP to block</Label>
                <Input id="ip" placeholder="e.g. 203.0.113.42" value={ipToBlock} onChange={(e) => setIpToBlock(e.target.value)} />
              </div>
              <div className="grid flex-1 gap-2">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input id="reason" placeholder="spam, abuse, etc." value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={doBlockIp}>Block IP</Button>
              <Button variant="destructive" onClick={doResetLeaderboard}>Reset Leaderboard</Button>
              <Button variant="secondary" onClick={doClearAbuse}>Clear Abuse</Button>
            </div>

            <Separator className="my-2" />

            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocked.map((b) => (
                    <TableRow key={b.ip}>
                      <TableCell className="font-mono text-xs md:text-sm">{b.ip}</TableCell>
                      <TableCell className="text-xs md:text-sm">{b.reason ?? '-'}</TableCell>
                      <TableCell className="text-xs md:text-sm">{new Date(b.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => doUnblockIp(b.ip)}>Unblock</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {blocked.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        No blocked IPs.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}