/*
 * Stand-in for plugins that need the internet (CAD Agent / AI assistant,
 * OneDrive, Google Drive). `vite --mode offline` aliases those packages here
 * so their code, endpoints and SDK loaders are not part of the offline
 * bundle. Every export throws when used: callers already treat a failing
 * plugin as "not installed" and hide its UI.
 */
const unavailable = () => {
  throw new Error('Not available in the offline version')
}

export const setAgentPaletteOpener = unavailable
export const mergeAgentI18nIntoVueI18n = unavailable
export const registerLazyAgentPlugin = unavailable
export const AgentChatPanel = undefined

export const registerOneDrivePlugin = unavailable
export const registerGoogleDrivePlugin = unavailable

export class AcApOneDriveDataSource {
  constructor() {
    unavailable()
  }
}

export class AcApGoogleDriveDataSource {
  constructor() {
    unavailable()
  }
}
