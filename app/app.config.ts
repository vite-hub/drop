import { customizeIcon, iconAliases, ui } from "../shared/ui-config"

export default defineAppConfig({
  icon: { customize: customizeIcon, aliases: iconAliases },
  ui,
})
