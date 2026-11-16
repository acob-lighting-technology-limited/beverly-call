<script setup lang="ts">
/** Sticky screen header: title row (leading control, actions) plus an optional KPI strip in the default slot.
 *  Measures itself and folds the KPI strip on scroll (see lib/sticky-head.ts). Used by: every view under views/. */
defineProps<{ title: string }>()
</script>

<template>
  <div v-sticky-head class="head">
    <div class="ht"><slot name="leading" /><h1>{{ title }}</h1><slot name="actions" /></div>
    <div class="head-body"><slot /></div>
  </div>
</template>
