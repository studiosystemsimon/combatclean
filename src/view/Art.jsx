// Renders a resolved asset ({emoji,label,img}) as an <img> when art exists,
// else the emoji fallback. `className` styles both (img fills, emoji sizes).
export default function Art({ a, className = '' }) {
  if (a && a.img) {
    return <img className={`art-img ${className}`} src={a.img} alt={a.label || ''} draggable={false} />;
  }
  return <span className={`art-emoji ${className}`}>{a ? a.emoji : '❓'}</span>;
}
