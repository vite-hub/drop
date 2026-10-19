// Every drop is a node. A folder holds other drops, folders included; a doc holds the files it embeds. Sharing a
// folder shares everything below it, and the folder's lifetime and Trash apply to the whole subtree.

/** How deep drops nest: at most this many nodes from the top down to a drop, itself included. Embedded files don't count. */
export const MAX_DEPTH = 8
