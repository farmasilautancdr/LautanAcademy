import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import ms from './locales/ms.json'

const STORAGE_KEY = 'lautan_lang'
const savedLocale = localStorage.getItem(STORAGE_KEY)

const i18n = createI18n({
  legacy: false,
  locale: savedLocale === 'ms' ? 'ms' : 'en',
  fallbackLocale: 'en',
  messages: { en, ms },
})

export default i18n
export { STORAGE_KEY }
