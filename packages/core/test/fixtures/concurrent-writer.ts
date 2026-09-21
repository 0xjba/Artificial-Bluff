// Child process for the concurrency test: appends N events to one game in a shared database file.
import { EventStore } from '../../src/store'

const [dbPath, gameId, count] = process.argv.slice(2)
const store = new EventStore(dbPath!)
for (let i = 0; i < Number(count); i++) {
  store.append(gameId!, { type: 'hand_ended', handId: `h${i}`, stacks: {}, net: {} })
}
store.close()
