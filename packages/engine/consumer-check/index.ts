// Simulates an external consumer importing @ab/engine from source, to make sure
// its types (including the ambient `phe` declaration) resolve outside the engine's own tsconfig.
import { buildMenu, createHand } from '../src/index'

const hand = createHand({
  seats: [
    { id: 'a', stack: 1000 },
    { id: 'b', stack: 1000 },
  ],
  buttonIndex: 0,
  smallBlind: 25,
  bigBlind: 50,
  seed: 1,
})

const menu = buildMenu(hand)
console.log(hand.toAct, menu.length)
