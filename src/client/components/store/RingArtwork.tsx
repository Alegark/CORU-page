import type { ProductArtwork, ProductImageSource } from '../../../shared/types'
import { productImageAlt } from '../../../shared/seo'

export function RingArtwork({ artwork, label, large = false, imageUrl, imageSource, priority = false, material, description }: { artwork: ProductArtwork; label: string; large?: boolean; imageUrl?: string; imageSource?: ProductImageSource; priority?: boolean; material?: string; description?: string }) {
  const alt = productImageAlt(label, material, description)
  const fallback = imageSource?.src ?? imageUrl
  if (fallback) {
    const src = large ? imageSource?.detail1200 ?? fallback : imageSource?.thumb640 ?? imageSource?.thumb320 ?? fallback
    const srcSet = large
      ? [[imageSource?.thumb640, '640w'], [imageSource?.detail1200, '1200w']].filter((entry): entry is [string, string] => Boolean(entry[0])).map(([url, width]) => `${url} ${width}`).join(', ')
      : [[imageSource?.thumb320, '320w'], [imageSource?.thumb640, '640w']].filter((entry): entry is [string, string] => Boolean(entry[0])).map(([url, width]) => `${url} ${width}`).join(', ')
    return <img className={`ring-image${large ? ' ring-image-large' : ''}`} src={src} {...(srcSet ? { srcSet } : {})} sizes={large ? '(max-width: 767px) 100vw, 55vw' : '(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw'} alt={alt} loading={priority ? 'eager' : 'lazy'} {...{ fetchpriority: priority ? 'high' : 'low' }} decoding="async" />
  }
  return (
    <svg className={`ring-art${large ? ' ring-art-large' : ''}`} viewBox="0 0 260 220" role="img" aria-label={alt}>
      <defs>
        <linearGradient id={`ring-sheen-${artwork}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#d7dbe0" />
          <stop offset="1" stopColor="#8f969e" />
        </linearGradient>
        <filter id={`ring-shadow-${artwork}`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000" floodOpacity="0.12" />
        </filter>
      </defs>
      <ellipse cx="130" cy="150" rx="91" ry="28" fill="#000" opacity="0.05" />
      <g filter={`url(#ring-shadow-${artwork})`}>
        <ellipse cx="130" cy="126" rx="78" ry="57" fill="none" stroke="url(#ring-sheen-${artwork})" strokeWidth="22" />
        <ellipse cx="130" cy="120" rx="63" ry="44" fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="4" />
        {artwork === 'star' && <path d="m130 34 12 28 31 3-24 21 7 31-26-16-27 16 8-31-25-21 32-3Z" fill="#111" />}
        {artwork === 'cross' && <path d="M120 35h20v28h28v20h-28v29h-20V83H92V63h28Z" fill="#111" />}
        {artwork === 'skull' && <path d="M130 35c-29 0-47 21-47 47 0 18 9 30 22 36v16h18v-11h14v11h18v-16c14-8 22-20 22-36 0-26-19-47-47-47Zm-20 48a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm40 0a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm-22 16-9-10h18Z" fill="#111" />}
        {artwork === 'pearl' && <circle cx="130" cy="57" r="26" fill="#fff" stroke="#aab2bb" strokeWidth="4" />}
        {artwork === 'orbita' && <><circle cx="130" cy="58" r="25" fill="#111" /><circle cx="122" cy="50" r="8" fill="#fff" opacity="0.45" /></>}
        {artwork === 'chain' && <><path d="M99 52c-12-14 7-28 19-16l24 24c11 12-6 29-19 17Z" fill="none" stroke="#111" strokeWidth="10"/><path d="M142 52c12-14 31 2 19 16l-24 25c-12 12-29-5-18-17Z" fill="none" stroke="#111" strokeWidth="10"/></>}
      </g>
    </svg>
  )
}
