/**
 * @typedef {{ id: number, x: number, y: number }} Point
 * Touch point; x and y are 0..1 relative to the video box.
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/**
 * @typedef {{
 *   t: 'state',
 *   capturing: boolean,
 *   accessibility: boolean,
 *   capture: { w: number, h: number },
 *   transport?: Transport,
 *   touch?: boolean,
 * }} StateMsg
 */

/** @typedef {'webrtc'|'h264ws'} Transport */

/** @typedef {{ t: 'answer', sdp: string }} AnswerMsg */

/** @typedef {{ t: 'ice', candidate: RTCIceCandidateInit }} IceMsg */

/** @typedef {StateMsg | AnswerMsg | IceMsg} InboundMsg */

/**
 * @typedef {{ t: 'offer', sdp: string }
 *   | IceMsg
 *   | { t: 'touch', pts: Point[] }
 *   | { t: 'key', k: string }} OutboundMsg
 */

export {};
