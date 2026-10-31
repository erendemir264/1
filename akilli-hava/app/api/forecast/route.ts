import { NextResponse } from 'next/server';
import { analyze } from '@/lib/analyze';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: 'Geçersiz konum' }, { status: 400 });
  }
  // ~1 km rounding: same answer for neighbours, better caching
  const rl = Math.round(lat * 100) / 100;
  const ro = Math.round(lon * 100) / 100;
  try {
    const data = await analyze(rl, ro);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Bilinmeyen hata' }, { status: 502 });
  }
}
