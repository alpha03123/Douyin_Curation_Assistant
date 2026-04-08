<template>
  <el-card class="metric-card" shadow="hover">
    <p class="metric-card__label">{{ label }}</p>
    <p class="metric-card__value">{{ value }}</p>
    <p class="metric-card__note">{{ note }}</p>
  </el-card>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  note: { type: String, default: "" },
});
</script>
