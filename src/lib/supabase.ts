import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://wblnwqqsbobcdjllrhum.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndibG53cXFzYm9iY2RqbGxyaHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0NTUwMTAsImV4cCI6MjA3NDAzMTAxMH0.hxUvxTfxv04G0rPLjybsG_muW2wwgUtFb2Vyotzkmlc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);