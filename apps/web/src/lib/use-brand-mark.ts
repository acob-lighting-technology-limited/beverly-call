import { computed, type ComputedRef } from 'vue'
import { useSettings } from '@/stores/settings'

/** Beverly Call logo: dark-bodied on light themes, white-bodied on dark themes. `onDark` forces the white version (the nav rail is always dark). */
export function useBrandMark(onDark = false): ComputedRef<string> {
  const settings = useSettings()
  return computed(() => (onDark || settings.isDark() ? '/brand/beverly-call-mark-light.png' : '/brand/beverly-call-mark.png'))
}
