export function InventoryBadge({ quantity }: { quantity: number }) {
  return <span className={`stock-label${quantity <= 3 ? ' is-low' : ''}`}>{quantity > 0 ? `${quantity} en stock` : 'Agotado'}</span>
}

