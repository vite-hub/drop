<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

// `::roles-table`: each role and what it can do, from the same list the app checks.
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>What they can do</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in ROLES" :key="role">
          <td>{{ ROLE_LABELS[role] }}</td>
          <td>{{ ROLE_SUMMARY[role] }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
