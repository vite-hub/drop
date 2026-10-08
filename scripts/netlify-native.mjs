import { cpSync, lstatSync, mkdirSync, unlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const source = resolve(root, "node_modules/@libsql/linux-x64-gnu")
const target = resolve(root, ".netlify/functions-internal/server/node_modules/@libsql/linux-x64-gnu")
mkdirSync(dirname(target), { recursive: true })
if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(target)
cpSync(source, target, { recursive: true })
