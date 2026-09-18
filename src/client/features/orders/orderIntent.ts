/** Local fallback kept for the Vite-only preview; the cart prefers the
 * Worker adapter below when the API is available. */
export { createOrderIntent } from '../../../shared/orders'
export type { CreateOrderResult } from '../../../shared/orders'

import { createWhatsappOrder } from '../../api/public'
import type { OrderIntentInput, OrderIntentResponse } from '../../../shared/contracts'

/** Worker adapter used by the cart.  The overlay falls back to the local
 * implementation only when the Vite-only preview has no API route. */
export function createOrderIntentRemote(input: OrderIntentInput, idempotencyKey: string, signal?: AbortSignal): Promise<OrderIntentResponse> {
  return createWhatsappOrder(input, idempotencyKey, signal)
}
