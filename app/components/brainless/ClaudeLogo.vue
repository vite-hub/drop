<script setup lang="ts">
// Claude Code's launch sprite as a crisp SVG grid. Ported from Brainless (MIT, see LICENSE).
const BITS = ["000111111111111000", "000110111111011000", "011111111111111110", "000111111111111000", "000010100001010000"]
// Terminal cells are taller than wide, so each sprite pixel is stretched vertically.
const PH = 2.4
const rects = BITS.flatMap((row, y) => [...row.matchAll(/1+/g)].map(run => ({ x: run.index, y: y * PH, width: run[0].length })))
</script>

<template>
  <svg aria-hidden="true" :viewBox="`0 0 18 ${BITS.length * PH}`" shape-rendering="crispEdges" fill="#cd694a">
    <rect v-for="rect in rects" :key="`${rect.x}-${rect.y}`" :x="rect.x" :y="rect.y" :width="rect.width" :height="PH" />
  </svg>
</template>
