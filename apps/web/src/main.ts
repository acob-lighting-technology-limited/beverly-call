import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSettings } from './stores/settings'
import { useInbox } from './stores/inbox'
import { initPwa } from './lib/pwa'
import { vHoverScroll } from './lib/hover-scroll'
import { vStickyHead } from './lib/sticky-head'
import './styles/tokens.css'
import './styles/design-tokens.css'
import './styles/app.css'

const app = createApp(App).use(createPinia()).use(router).directive('hover-scroll', vHoverScroll).directive('sticky-head', vStickyHead)
useSettings().apply()
app.mount('#root')
initPwa({
  onNavigate: (link) => { void router.push(link) },
  // A push means something just happened: refresh now instead of waiting for the next poll. The refresh rings for a call.
  onPush: () => { void useInbox().refresh() },
})
