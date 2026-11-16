<script setup lang="ts">
/** Users and roles from Beverly. Data: /admin/users, /admin/roles. Used by: AdminView. */
import type { RoleSummary, StaffUser } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { useViewMode } from '@/lib/use-view-mode'
import { shortDate } from '@/lib/format'

const users = useResource(() => api<StaffUser[]>('/admin/users'))
const roles = useResource(() => api<RoleSummary[]>('/admin/roles'))
const { mode: staffMode, set: setStaffMode } = useViewMode('admin-staff')
const { mode: rolesMode, set: setRolesMode } = useViewMode('admin-roles')
</script>

<template>
  <div class="bento">
      <div class="c s7 w2"><div class="hd"><Icon name="users" /><b>Staff with call access</b></div>
        <StateBanner :loading="users.loading.value" :error="users.error.value" what="staff" />
        <div class="vt-row"><ViewToggle :model-value="staffMode" @update:model-value="setStaffMode" /></div>
        <div class="scroll" :class="staffMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Name</th><th>Role</th><th>Active</th><th>Last login</th></tr></thead>
          <tbody><tr v-for="u in users.data.value ?? []" :key="u.id"><td data-label="Name">{{ u.name }}</td><td data-label="Role">{{ u.roleLabel ?? u.role.replace('custom-call-centre-', '') }}</td><td data-label="Active"><span class="pill" :class="u.active ? 'ok' : 'vi'">{{ u.active ? 'Active' : 'Off' }}</span></td><td data-label="Last login">{{ u.lastLogin ? shortDate(u.lastLogin) : 'Never' }}</td></tr></tbody></table></div>
        <p class="adm-sub">Managed in Beverly Wallet Admin.</p></div>

      <div class="c s5 w2"><div class="hd"><Icon name="lock" /><b>Beverly roles</b></div>
        <StateBanner :loading="roles.loading.value" :error="roles.error.value" what="roles" />
        <div class="vt-row"><ViewToggle :model-value="rolesMode" @update:model-value="setRolesMode" /></div>
        <div class="scroll" :class="rolesMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Role</th><th>People</th><th>Permissions</th></tr></thead>
          <tbody><tr v-for="r in roles.data.value ?? []" :key="r.roleKey"><td data-label="Role">{{ r.label }}</td><td data-label="People">{{ r.people }}</td><td data-label="Permissions">{{ r.permissions }}</td></tr></tbody></table></div></div>
  </div>
</template>

<style scoped>
.adm-sub { display: block; color: var(--text-muted); font-size: var(--fs-sm); margin: var(--sp-1) 0 0; }
</style>
