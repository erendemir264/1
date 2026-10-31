# Akıllı Hava ☂️

UV indeksi, basınç gibi kimsenin bakmadığı rakamlar yok. Uygulama tek bir soruya cevap verir:
**"Dışarı çıkarken ne giymeliyim, şemsiye almalı mıyım, buna ne kadar güvenebilirim?"**

## Ne yapar?

- **Tek cümlelik özet:** "13:00–17:00 arası hafif yağmur bekleniyor. Sabah 12°, akşam 9°."
- **Tavsiye:** "Akşam için mont al; sabah ceket yeter", "Şemsiye al", rüzgar sertse "Yağmurluk ya da kapüşon".
- **Güven oranı:** "Güven: Orta · %68". Dokununca tek satırlık sebebini gösterir ("10 senaryodan 6 tanesinde yağmur var").
- **Kısa uyarılar:** rüzgar yağışın saatini kaydırabilir, sağanak her yere düşmeyebilir, dünkü tahmin değişti, yağışın başlama saati belirsiz...
- **Yağmur takibi (0–3 saat):** radardaki yağış alanının iki kare arasında nereye kaydığına bakılır:
  "Yağış bulutu 34 km batısında, 37 km/s ile geliyor, ~50 dk sonra başlayabilir, zayıflıyor / dağılabilir."
- **"Dışarıda olacağım" planlayıcısı:** gün + saat aralığı seç (ör. bu akşam 18–23), o aralığa özel tavsiye al.
- Saat saat şerit ve yağış/rüzgar haritası.

## Nasıl hesaplanıyor?

1. **6 bağımsız hava modeli** (ECMWF, ICON, GFS, ARPEGE, UKMO, GEM) + **~120 ensemble senaryosu**
   (ECMWF 51, ICON 40, GFS 31 üye) tek bir ağırlıklı "senaryo havuzunda" birleştirilir.
   Her sistem, üye sayısından bağımsız olarak eşit ağırlık alır.
2. **Yağmur ihtimali** = o saatlerde yağmur gösteren senaryoların ağırlıklı oranı.
   Bir zaman aralığı için "en az bir saatinde yağan senaryo" sayılır (saatlik ihtimallerin en büyüğü değil),
   yani "akşam yağar mı?" sorusunun doğru cevabı.
3. **Radar takibi:** RainViewer radarının son kareleri ~4 km'lik ızgaraya çevrilir, blok eşleştirme ile yağış alanının
   hareket vektörü bulunur ve konuma doğru ilerletilir. Yağış alanının büyüyüp küçülmesi ve üst katman (700 hPa) nemi ile
   "yolda dağılma ihtimali" hesaplanır. Radar kapsamı yoksa konumun çevresindeki 150 km'lik 60 noktalı model taraması
   + bulutları taşıyan 700 hPa rüzgarı kullanılır.
4. **İlk 3 saat** radar takibiyle düzeltilir (gözlem, modelden daha güvenilirdir).
5. **Dünkü tahminle karşılaştırma:** aynı model 24 saat önce ne demişti? Ciddi fark varsa kullanıcıya söylenir ve güven düşer.
6. **Güven** = yağmur konusunda senaryoların ne kadar hemfikir olduğu + sıcaklık/rüzgar yayılımı + ileri zaman payı.
   %95'in üstüne hiç çıkmaz.

Kıyafet önerisi "hissedilen" sıcaklığa (rüzgar ve nem dahil) göre yapılır.

## Vercel'e yükleme

1. Vercel → **Add New Project** → bu repoyu seç.
2. **Root Directory** olarak `akilli-hava` klasörünü seç (Framework: Next.js otomatik algılanır).
3. Deploy. Ortam değişkeni veya API anahtarı gerekmez.

## Yerelde çalıştırma

```bash
cd akilli-hava
npm install
npm run dev     # http://localhost:3000
npm test        # sahte verilerle analiz motoru testi (internet gerekmez)
```

## Veri kaynakları

- [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) — modeller, ensemble, geçmiş tahminler, şehir arama. Ticari olmayan kullanım ücretsiz.
- [RainViewer](https://www.rainviewer.com/) — radar (kapsama alanı ülkeye göre değişir).
- OpenStreetMap — harita, BigDataCloud — konum adı.
