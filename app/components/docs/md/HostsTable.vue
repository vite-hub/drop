<script setup lang="ts">
// `::hosts-table`: each host Drop runs on, with its database, files, rate limits, and code images, from the same list the deploy buttons use.
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table>
      <thead><tr><th>Host</th><th>Database</th><th>Files</th><th>Rate limits</th><th>Code images</th></tr></thead>
      <tbody>
        <tr v-for="host in HOSTS" :key="host.id">
          <td><NuxtLink :to="`/docs/self-host/${host.id}`">{{ host.name }}</NuxtLink></td>
          <td>{{ host.database }}</td>
          <td>{{ host.files }}</td>
          <td>{{ host.rateLimits }}</td>
          <td>{{ host.codeImages }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
