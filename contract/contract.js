// Stark shared contract v1. CONTRACT.md is authoritative; this file mirrors it.
// Owner: Ray. Agents import it; they never edit it.
// Works in Node (import from '../contract/contract.js') and the browser ('/contract/contract.js').

export const CONTRACT_VERSION = 1;

/** Socket.io event names. Direction and permission: see CONTRACT.md section 5. */
export const EVENTS = Object.freeze({
  REGISTER: 'register',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  TAKE_CONTROL: 'take-control',
  DRIVER_CHANGED: 'driver-changed',
  CONTROL_ORBIT: 'control-orbit',
  CONTROL_ZOOM: 'control-zoom',
  FOCUS_TIP: 'focus-tip',
  CLEAR_FOCUS: 'clear-focus',
  FOCUS_STATE: 'focus-state',
  RESET_VIEW: 'reset-view',
  SELECT_IMAGE: 'select-image',
  PLAY_PULSE: 'play-pulse',
  SET_MODE: 'set-mode',
  DISPLAY_STATE: 'display-state',
  STEER_UPDATE: 'steer-update',
  STEER_RESULT: 'steer-result',
  STEER_RESET: 'steer-reset',
  ERROR: 'error',
});

export const ROLES = Object.freeze({ DISPLAY: 'display', HOST: 'host', GUEST: 'guest' });

/** Display mode. Layer mode is separate (LAYER_MODES). */
export const MODES = Object.freeze({ NORMAL: 'normal', STABILITY: 'stability', TRUNK: 'trunk' });

export const LAYER_MODES = Object.freeze({ FULL: 'full', REDUCED: 'reduced' });

export const PLAYBACK_STATES = Object.freeze({ IDLE: 'idle', PLAYING: 'playing', DONE: 'done' });

export const CATEGORIES = Object.freeze({
  CLEAN: 'clean',
  AMBIGUOUS: 'ambiguous',
  ADVERSARIAL: 'adversarial',
  MEDICAL: 'medical',
});

/** softmax: ImageNet scores summing to 1. independent: per-finding medical scores, not mutually exclusive. */
export const SCORE_KINDS = Object.freeze({ SOFTMAX: 'softmax', INDEPENDENT: 'independent' });

export const ERROR_CODES = Object.freeze({
  NO_ROOM: 'NO_ROOM',
  BAD_KEY: 'BAD_KEY',
  LOCKED: 'LOCKED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_PAYLOAD: 'BAD_PAYLOAD',
  RATE_LIMITED: 'RATE_LIMITED',
});

export const DEFAULTS = Object.freeze({
  MS_PER_LAYER: 120,
  SEND_HZ: 30,
  DRIVER_IDLE_MS: 20000,
  TOP_K: 25,
  ANSWER_LIST: 10,
});

/** Server-issued room codes. STARK_FIXED_ROOM (env) overrides; it must use the same alphabet. */
export const ROOM_CODE = Object.freeze({
  LENGTH: 5,
  ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // A–Z without I and O, digits 2–9
});

/** Ready flag set to true on window once a page is usable (see CONTRACT.md section 9). */
export const READY_FLAG = '__starkReady';

// ---------------------------------------------------------------------------
// Typedefs (JSDoc). Field meanings and examples live in CONTRACT.md.
// ---------------------------------------------------------------------------

/**
 * @typedef {'clean'|'ambiguous'|'adversarial'|'medical'} Category
 * @typedef {'display'|'host'|'guest'} Role
 * @typedef {'normal'|'stability'|'trunk'} Mode
 * @typedef {'full'|'reduced'} LayerMode
 * @typedef {'softmax'|'independent'} ScoreKind
 */

/**
 * @typedef {Object} ClassRef
 * @property {number} classId  ImageNet index 0–999, or pathology index 0–17 for medical images
 * @property {string} label
 */

/**
 * @typedef {Object} ManifestImage
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {number} order        1-based host gallery order
 * @property {ClassRef|null} trueClass
 * @property {string} folder       relative to the site root, trailing slash
 * @property {{crop:boolean, tree:boolean, gradcam:boolean, atlas:boolean, stability:boolean, fgsm:boolean, medical:boolean}} files
 *
 * @typedef {Object} Manifest
 * @property {'stark.manifest/1'} schema
 * @property {ManifestImage[]} images
 */

/**
 * @typedef {Object} TreeNode
 * @property {string} id           WordNet ID (n########), 'other', or 'root'/'f<i>' in a fan
 * @property {string} label
 * @property {number} depth        edges from the root after collapsing
 * @property {string|null} parent
 * @property {string[]} children
 * @property {number|null} value   sum of leaf scores beneath (softmax trees); the score itself on fan leaves; null on the fan root
 * @property {boolean} isLeaf
 * @property {boolean} onTop1Path
 * @property {boolean} isTrueLabel
 * @property {boolean} isOther
 * @property {number|null} classId leaves only
 * @property {number|null} rank    leaves only, 1-based
 *
 * @typedef {Object} TopKEntry
 * @property {number} rank
 * @property {number} classId
 * @property {string|null} wnid
 * @property {string} label
 * @property {number} score
 *
 * @typedef {Object} Tree
 * @property {'stark.tree/1'} schema
 * @property {'wordnet'|'fan'} kind
 * @property {ScoreKind} scoreKind
 * @property {string} model
 * @property {string} imageId
 * @property {string} rootId
 * @property {{classId:number, label:string, score:number}} top1
 * @property {{classId:number, label:string, score:number, rank:number}|null} trueClass
 * @property {number|null} otherScore  softmax mass outside topK (null for fans)
 * @property {TopKEntry[]} topK        length ≤ DEFAULTS.TOP_K (fan: every finding)
 * @property {TreeNode[]} nodes        depth-first order, root first
 */

/**
 * @typedef {Object} GradcamEntry
 * @property {number} classId
 * @property {string} label
 * @property {boolean} hasHeatmap
 * @property {string|null} file       relative to the image folder; null iff !hasHeatmap
 * @property {number|null} rawMax     pre-normalization max; null iff !hasHeatmap
 *
 * @typedef {Object} GradcamIndex
 * @property {'stark.gradcam/1'} schema
 * @property {string} imageId
 * @property {string} targetLayer
 * @property {number} width
 * @property {number} height
 * @property {'png-gray8'} encoding
 * @property {string} normalization
 * @property {GradcamEntry[]} classes  one entry per topK class (+ true class)
 */

/**
 * @typedef {Object} AtlasLayer
 * @property {number} index
 * @property {string} name
 * @property {string} stage
 * @property {string|null} block
 * @property {'stem'|'conv'|'block-out'} kind
 * @property {number} width
 * @property {number} height
 * @property {number} maxRaw
 * @property {number} offset   byte offset into atlas.bin
 * @property {number} length   width * height
 *
 * @typedef {Object} AtlasSkip
 * @property {string} block
 * @property {string} fromLayer
 * @property {string} toLayer
 * @property {boolean} projection
 *
 * @typedef {Object} AtlasMeta
 * @property {'stark.atlas/1'} schema
 * @property {string} imageId
 * @property {string} file
 * @property {'uint8'} dtype
 * @property {string} order
 * @property {string} channelReduction
 * @property {string} quantization
 * @property {number} totalBytes
 * @property {AtlasLayer[]} layers
 * @property {AtlasSkip[]} skips
 *
 * @typedef {Object} LayerConfig
 * @property {'stark.layers/1'} schema
 * @property {{index:number, name:string, stage:string, full:boolean, reduced:boolean}[]} layers
 */

/**
 * @typedef {Object} StabilityResult
 * @property {'stark.stability/1'} schema
 * @property {string} imageId
 * @property {'test-time augmentation'} method
 * @property {number} runs
 * @property {number} seed
 * @property {{cropAreaFrac:[number,number], hflipProb:number, brightnessDelta:number}} transforms
 * @property {{run:number, top1ClassId:number, top1Score:number}[]} perRun
 * @property {{classId:number, label:string, count:number}[]} winners
 * @property {number} distinctWinners
 * @property {{classId:number, label:string, mean:number, std:number}[]} classes
 */

/**
 * @typedef {Object} FgsmResult
 * @property {'stark.fgsm/1'} schema
 * @property {string} sourceImageId
 * @property {string} adversarialImageId
 * @property {number} epsilon
 * @property {number} epsilon255
 * @property {number[]} epsilonsTried255
 * @property {string} pixelSpace
 * @property {{classId:number, label:string, score:number}} original
 * @property {{classId:number, label:string, score:number}} adversarial
 * @property {{classId:number, label:string, adversarialScore:number}} trueClass
 * @property {string|null} noiseFile
 */

/**
 * @typedef {Object} MedicalFinding
 * @property {number} classId   index into the model's pathology list
 * @property {string} label
 * @property {number} score     independent score, 0–1
 * @property {number} rank
 * @property {boolean} hasHeatmap
 * @property {string|null} file
 *
 * @typedef {Object} MedicalResult
 * @property {'stark.medical/1'} schema
 * @property {string} imageId
 * @property {string} model
 * @property {'independent'} scoreKind
 * @property {string} caveat
 * @property {string} gradcamTargetLayer
 * @property {{classId:number, label:string, source:string}|null} sourceLabel
 * @property {MedicalFinding[]} findings
 */

/**
 * @typedef {Object} Answer
 * @property {number} classId
 * @property {string} label
 * @property {number} score       model score (never "probability correct")
 * @property {number} rank
 * @property {boolean} hasHeatmap
 * @property {boolean} isTop1
 * @property {boolean} isTrueClass
 *
 * @typedef {Object} Driver
 * @property {string} id
 * @property {string} label
 * @property {boolean} isHost
 *
 * @typedef {Object} Capabilities
 * @property {boolean} stability
 * @property {boolean} trunkInterior
 * @property {boolean} layerModes
 * @property {boolean} bloom
 * @property {boolean} steer
 *
 * @typedef {Object} DisplayState
 * @property {string} room
 * @property {{id:string, name:string, category:Category}} image
 * @property {ScoreKind} scoreKind
 * @property {Answer} top1
 * @property {Answer|null} trueClass
 * @property {Mode} mode
 * @property {LayerMode} layerMode
 * @property {{state:'idle'|'playing'|'done', speed:number}} playback
 * @property {Answer|null} focus
 * @property {Driver|null} driver
 * @property {number} controllerCount
 * @property {Capabilities} capabilities
 * @property {Answer[]} answers   top ANSWER_LIST by rank, plus the true class if outside them
 *
 * @typedef {Answer|null} FocusState
 */

/**
 * @typedef {Object} SteerChannel
 * @property {number} channelIndex
 * @property {string} label
 * @property {number} baseWeight
 * @property {number} scale
 *
 * @typedef {Object} SteerState
 * @property {boolean} active
 * @property {string} layer
 * @property {'slider'|'code'} mode
 * @property {SteerChannel[]} channels
 * @property {string|null} code
 * @property {{answers:Answer[], treeValues:Object<string, number>}|null} result
 * @property {string|null} error
 */

/**
 * @typedef {Object} StarkError
 * @property {'NO_ROOM'|'BAD_KEY'|'LOCKED'|'FORBIDDEN'|'BAD_PAYLOAD'|'RATE_LIMITED'} code
 * @property {string} message
 * @property {string} [event]     the event that caused it
 * @property {Driver} [driver]    present when code is LOCKED
 */

/**
 * HUD mount API (implemented by Codex in /web/ui/hud.js, called by /web/core).
 * @typedef {Object} HudApi
 * @property {(cb:(s:DisplayState)=>void)=>(()=>void)} onState   returns unsubscribe
 * @property {(cb:(f:FocusState)=>void)=>(()=>void)} onFocus     returns unsubscribe
 * @property {()=>string} getRoom
 * @property {(visible:boolean)=>void} setVisible
 */
