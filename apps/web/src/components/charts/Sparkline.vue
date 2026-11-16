<script setup lang="ts">
/** Tiny smooth trend line with a soft gradient, for stat cards. Decorative: the card carries the numbers. */
import { computed, useId } from 'vue'
import { areaPath, niceMax, smoothPath, toPoints } from '@/lib/chart-math'

const props = withDefaults(defineProps<{ values: number[]; height?: number; tone?: 'accent' | 'good' | 'bad' }>(), { height: 36, tone: 'accent' })
const uid = useId()
const pts = computed(() => toPoints(props.values, niceMax(Math.max(...props.values, 1)), 8))
const line = computed(() => smoothPath(pts.value))
const area = computed(() => areaPath(pts.value))
const color = computed(() => ({ accent: 'var(--accent)', good: 'var(--st-on)', bad: 'var(--danger)' })[props.tone])
</script>

<template>
  <svg v-if="values.length > 1" class="sp" viewBox="0 0 100 100" preserveAspectRatio="none" :style="{ height: `${height}px` }" aria-hidden="true">
    <defs><linearGradient :id="`sg${uid}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" :stop-color="color" stop-opacity="0.4" /><stop offset="100%" :stop-color="color" stop-opacity="0" /></linearGradient></defs>
    <path :d="area" :fill="`url(#sg${uid})`" />
    <path :d="line" :stroke="color" fill="none" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.sp { display: block; width: 100%; overflow: visible; }
</style>
