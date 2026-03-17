import { getDb } from '../db/client'

export function createContext() {
  return {
    db: getDb(),
  }
}

export type Context = ReturnType<typeof createContext>
