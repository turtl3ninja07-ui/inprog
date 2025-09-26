import { useEffect, useRef } from 'react';
import { geoEquirectangular, geoPath, geoContains, type GeoProjection, type GeoPermissibleObjects } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { FeatureCollection, Feature } from 'geojson';
import { alpha2FromNumeric } from '@/lib/leaderboard';

/**
 * WorldBackground
 * - Fullscreen high-DPI Canvas neon world map.
 * - Handles country selection by clicking on the map.
 * - Supports blip effects via window event 'world:blip' with detail: { code: string; kind: 'new' | 'repeat' }
 *   Minimal White Ping style:
 *   - new: single solid white dot grows from ~4px to ~22px and fades, soft glow, ~750ms
 *   - repeat: quick white flash thin ring, ~420ms
 * - Supports persistent pins via window event 'world:pin' with detail: { code: string }
 *   Pins: small cyan glowing dot with subtle ring, always visible.
 * - Emits 'world:hover' CustomEvent when pointer approaches a country's centroid:
 *   detail: { code: string | null, x: number, y: number }
 */
type Props = {
  onCountrySelect?: (alpha2: string) => void;
};

type BlipKind = 'new' | 'repeat';
type Blip = {
  x: number;
  y: number;
  kind: BlipKind;
  start: number; // ms timestamp
};

const WorldBackground = ({ onCountrySelect }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;

    let width = 0;
    let height = 0;
    let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2)); // cap DPR to reduce perf cost
    let projection: GeoProjection | null = null;
    let landGeo: GeoPermissibleObjects | null = null;
    let countryLinesGeo: GeoPermissibleObjects | null = null;
    let countriesFC: FeatureCollection | null = null;

    // Precomputed centroids for alpha2 codes
    const alpha2ToCentroid = new Map<string, [number, number]>();

    // Persistent pins (alpha2 codes)
    const pinned = new Set<string>();

    // Blip system
    const blips: Blip[] = [];

    const cleanupFns: Array<() => void> = [];

    const setSize = () => {
      const rect =
        canvas.parentElement?.getBoundingClientRect() ?? ({ width: window.innerWidth, height: window.innerHeight } as DOMRect);
      width = Math.floor(rect.width);
      height = Math.floor(rect.height);
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (landGeo) {
        projection = geoEquirectangular();
        try {
          // Slightly larger padding for better look across resolutions + a tiny upscale
          const padding = Math.max(12, Math.min(width, height) * 0.028);
          projection = projection.fitExtent([[padding, padding], [width - padding, height - padding]], landGeo);
          projection = projection.scale(projection.scale() * 1.06);
        } catch {
          const scale = width / (2 * Math.PI);
          projection = projection.scale(scale * 1.06).translate([width / 2, height / 2]);
        }
      }
    };

    const computeCentroids = () => {
      if (!projection || !countriesFC) return;
      alpha2ToCentroid.clear();
      const pathGeom = geoPath(projection); // no ctx: used for centroid computation
      for (const feat of countriesFC.features) {
        const id = (feat.id != null ? String(feat.id) : '').padStart(3, '0');
        const alpha2 = alpha2FromNumeric(id);
        if (!alpha2) continue;
        try {
          const c = pathGeom.centroid(feat as unknown as GeoPermissibleObjects);
          if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
            alpha2ToCentroid.set(alpha2, [c[0], c[1]]);
          }
        } catch {
          // ignore centroid errors
        }
      }
    };

    const drawGradientBackground = () => {
      const cx = width * 0.55;
      const cy = height * 0.45;
      const r = Math.hypot(width, height) * 0.9;
      const radial = ctx.createRadialGradient(cx, cy, Math.max(0, r * 0.05), cx, cy, r);
      radial.addColorStop(0, '#0a1420');
      radial.addColorStop(0.6, '#060d17');
      radial.addColorStop(1, '#000000');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);
    };

    const drawLand = () => {
      if (!projection || !landGeo) return;
      const path = geoPath(projection, ctx);
      const southGate = projection([0, -60]);
      const yClip = southGate ? southGate[1] : height;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, yClip);
      ctx.clip();

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Back glow layer (purple) - stronger
      ctx.shadowBlur = 24;
      ctx.shadowColor = '#7c3aed';
      ctx.strokeStyle = '#7c3aed';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      path(landGeo);
      ctx.stroke();

      // Mid glow layer (blue) - stronger
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#22d3ee';
      ctx.strokeStyle = '#22d3ee';
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      path(landGeo);
      ctx.stroke();

      // Crisp core stroke
      ctx.shadowBlur = 2;
      ctx.shadowColor = '#22d3ee';
      ctx.globalAlpha = 0.95;
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0.0, '#7c3aed');
      grad.addColorStop(0.5, '#22d3ee');
      grad.addColorStop(1.0, '#6366f1');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      path(landGeo);
      ctx.stroke();

      ctx.restore();
    };

    const drawCountryBoundaries = () => {
      if (!projection || !countryLinesGeo) return;
      const path = geoPath(projection, ctx);
      const southGate = projection([0, -60]);
      const yClip = southGate ? southGate[1] : height;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, yClip);
      ctx.clip();

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Back glow (purple)
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#7c3aed';
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      path(countryLinesGeo);
      ctx.stroke();

      // Mid glow (blue)
      ctx.shadowBlur = 16;
      ctx.shadowColor = '#22d3ee';
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      path(countryLinesGeo);
      ctx.stroke();

      // Crisp core with gradient to match land
      ctx.shadowBlur = 1;
      ctx.shadowColor = '#22d3ee';
      ctx.globalAlpha = 0.95;
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0.0, '#7c3aed');
      grad.addColorStop(0.5, '#22d3ee');
      grad.addColorStop(1.0, '#6366f1');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      path(countryLinesGeo);
      ctx.stroke();

      ctx.restore();
    };

    const drawPins = () => {
      if (!projection) return;
      ctx.save();
      for (const code of pinned) {
        const pos = alpha2ToCentroid.get(code);
        if (!pos) continue;
        const [x, y] = pos;
        // Glow dot
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#22d3ee';
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();

        // Subtle outer ring
        ctx.shadowBlur = 4;
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, y, 6.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawBlips = (now: number) => {
      const NEW_DURATION = 760; // ms
      const REPEAT_DURATION = 420; // ms
      const nextBlips: Blip[] = [];

      for (const b of blips) {
        const elapsed = now - b.start;

        if (b.kind === 'new') {
          if (elapsed > NEW_DURATION) continue;
          const t = Math.min(1, Math.max(0, elapsed / NEW_DURATION));
          const radius = 4 + t * 18; // ~4 -> ~22
          const fade = 1 - t;

          ctx.save();
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#ffffff';
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          nextBlips.push(b);
        } else {
          if (elapsed > REPEAT_DURATION) continue;
          const t = Math.min(1, Math.max(0, elapsed / REPEAT_DURATION));
          const radius = 8 + t * 12;
          const fade = 1 - t;

          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#ffffff';
          ctx.globalAlpha = Math.max(0, 0.85 * fade);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          nextBlips.push(b);
        }
      }

      blips.splice(0, blips.length, ...nextBlips);
    };

    const frame = () => {
      ctx.clearRect(0, 0, width, height);
      drawGradientBackground();
      drawLand();
      drawCountryBoundaries();
      drawPins();
      drawBlips(performance.now());

      rafRef.current = requestAnimationFrame(frame);
    };

    const init = async () => {
      setSize();

      try {
        const topoModuleLand: unknown = await import('world-atlas/land-110m.json');
        const topoLand = (topoModuleLand as { default?: unknown }).default ?? topoModuleLand;

        type TopologyLike = { objects: Record<string, unknown> };

        const topoForFeature = topoLand as unknown as Parameters<typeof feature>[0];
        const landObject = (topoLand as TopologyLike).objects['land'] as unknown as Parameters<typeof feature>[1];
        landGeo = feature(topoForFeature, landObject) as unknown as GeoPermissibleObjects;

        const topoModuleCountries: unknown = await import('world-atlas/countries-110m.json');
        const topoCountries = (topoModuleCountries as { default?: unknown }).default ?? topoModuleCountries;

        const topoForMesh = topoCountries as unknown as Parameters<typeof mesh>[0];
        const countriesObject = (topoCountries as TopologyLike).objects['countries'] as unknown as Parameters<typeof mesh>[1];

        const borders = mesh(topoForMesh, countriesObject, (a, b) => a !== b);
        countryLinesGeo = borders as unknown as GeoPermissibleObjects;

        const topoForFeature2 = topoCountries as unknown as Parameters<typeof feature>[0];
        const countriesObject2 = (topoCountries as TopologyLike).objects['countries'] as unknown as Parameters<typeof feature>[1];
        const fc = feature(topoForFeature2, countriesObject2) as unknown as FeatureCollection;
        countriesFC = fc;
      } catch {
        // ignore
      }

      setSize();
      if (landGeo) {
        projection = geoEquirectangular();
        try {
          const padding = Math.max(12, Math.min(width, height) * 0.028);
          projection = projection.fitExtent([[padding, padding], [width - padding, height - padding]], landGeo);
          projection = projection.scale(projection.scale() * 1.06);
        } catch {
          const scale = width / (2 * Math.PI);
          projection = projection.scale(scale * 1.06).translate([width / 2, height / 2]);
        }
      }

      computeCentroids();

      rafRef.current = requestAnimationFrame(frame);

      const onResize = () => {
        setSize();
        computeCentroids();
      };
      window.addEventListener('resize', onResize);
      cleanupFns.push(() => window.removeEventListener('resize', onResize));

      // Map click -> select country & show immediate "new" white blip at centroid
      const onClick = (e: MouseEvent) => {
        if (!projection || !countriesFC) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const lonlat = projection!.invert!([x, y]);
        if (!lonlat) return;

        const [lon, lat] = lonlat;
        let matched: Feature | null = null;
        for (const feat of countriesFC.features) {
          if (geoContains(feat as unknown as GeoPermissibleObjects, [lon, lat])) {
            matched = feat as Feature;
            break;
          }
        }
        if (matched) {
          const numeric = (matched.id != null ? String(matched.id) : '').padStart(3, '0');
          const alpha2 = alpha2FromNumeric(numeric);
          if (alpha2) {
            if (onCountrySelect) onCountrySelect(alpha2);
            const pos = alpha2ToCentroid.get(alpha2) ?? [x, y];
            blips.push({ x: pos[0], y: pos[1], kind: 'new', start: performance.now() });
          }
        }
      };
      canvas.addEventListener('click', onClick);
      cleanupFns.push(() => canvas.removeEventListener('click', onClick));

      // Hover detection -> dispatch 'world:hover'
      const dispatchHover = (code: string | null, x: number, y: number) => {
        const ev = new CustomEvent('world:hover', { detail: { code, x, y } });
        window.dispatchEvent(ev);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!projection || alpha2ToCentroid.size === 0) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let nearest: { code: string; d2: number } | null = null;
        for (const [code, [cx, cy]] of alpha2ToCentroid.entries()) {
          const dx = cx - mx;
          const dy = cy - my;
          const d2 = dx * dx + dy * dy;
          if (!nearest || d2 < nearest.d2) nearest = { code, d2 };
        }
        const threshold = 20; // px
        if (nearest && Math.sqrt(nearest.d2) <= threshold) {
          dispatchHover(nearest.code, mx, my);
        } else {
          dispatchHover(null, mx, my);
        }
      };

      const onPointerLeave = () => {
        dispatchHover(null, -1, -1);
      };

      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerleave', onPointerLeave);
      cleanupFns.push(() => {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
      });

      // Listen for persistent pin events
      const onPin = (e: Event) => {
        const ce = e as CustomEvent<{ code: string }>;
        const code = ce.detail?.code;
        if (!code) return;
        pinned.add(code.toUpperCase());
      };
      window.addEventListener('world:pin', onPin as EventListener);
      cleanupFns.push(() => window.removeEventListener('world:pin', onPin as EventListener));

      // Listen for blip events from app (e.g., button clicks)
      const onBlip = (e: Event) => {
        const ce = e as CustomEvent<{ code: string; kind: BlipKind }>;
        const detail = ce.detail;
        if (!detail || typeof detail.code !== 'string') return;
        const code = detail.code.toUpperCase();
        let pos = alpha2ToCentroid.get(code);

        // Fallback: compute centroid on the fly if not yet in cache (e.g., very fast first click)
        if ((!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) && projection && countriesFC) {
          try {
            const pathGeom = geoPath(projection);
            for (const feat of countriesFC.features) {
              const numeric = (feat.id != null ? String(feat.id) : '').padStart(3, '0');
              const a2 = alpha2FromNumeric(numeric);
              if (a2 === code) {
                const c = pathGeom.centroid(feat as unknown as GeoPermissibleObjects);
                if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                  pos = [c[0], c[1]];
                  alpha2ToCentroid.set(code, pos as [number, number]);
                }
                break;
              }
            }
          } catch {
            // ignore
          }
        }

        if (!pos) return;
        blips.push({ x: pos[0], y: pos[1], kind: detail.kind, start: performance.now() });
      };
      window.addEventListener('world:blip', onBlip as EventListener);
      cleanupFns.push(() => window.removeEventListener('world:blip', onBlip as EventListener));
    };

    init();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cleanupFns.forEach((fn) => fn());
    };
  }, [onCountrySelect]);

  return (
    <div className="absolute inset-0 bg-black z-0">
      <canvas ref={canvasRef} className="w-full h-full block" aria-hidden="true" />
    </div>
  );
};

export default WorldBackground;