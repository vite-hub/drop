<script setup lang="ts">
// `::shortcut-table`: a table of every keyboard shortcut, with its keys and where it works, from the list the ? dialog shows.
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table>
      <thead><tr><th>Keys</th><th>What it does</th><th>Where</th></tr></thead>
      <tbody>
        <template v-for="group in SHORTCUT_GROUPS" :key="group.title">
          <tr v-for="shortcut in group.shortcuts" :key="shortcut.label">
            <td class="whitespace-nowrap"><kbd v-for="key in shortcut.keys" :key="key" class="mr-1">{{ KEY_LABELS.get(key) ?? key.toUpperCase() }}</kbd></td>
            <td>{{ shortcut.label }}</td>
            <td>{{ shortcut.where ?? group.where }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
