/** @import { StateMsg, Transport } from './types.js' */

/**
 * @param {StateMsg} state
 * @returns {{ transport: Transport, touch: boolean }} missing fields mean an Android phone
 */
export function transportOf(state) {
  return { transport: state.transport ?? 'webrtc', touch: state.touch ?? true };
}
