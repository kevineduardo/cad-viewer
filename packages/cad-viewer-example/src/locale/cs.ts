export default {
  command: {
    ACAD: {
      quit: {
        description: 'Ukončí aplikaci a zavře všechny otevřené výkresy'
      },
      exit: {
        description: 'Ukončí aplikaci a zavře všechny otevřené výkresy'
      }
    }
  },

  example: {
    fileUpload: {
      brand: 'Aitra CadViewer',
      credit: 'Založeno na open-source projektu mlightcad/cad-viewer',
      title: 'Vyberte soubor CAD k zobrazení',
      subtitle: 'Importujte výkresy DWG nebo DXF do prohlížeče',
      offlineVersion:
        'Offline verze: stáhněte si prohlížeč a používejte jej bez internetu',
      newDrawing: 'Nový výkres',
      or: 'nebo',
      dropFile: 'Přetáhněte soubor nebo',
      browse: 'procházet',

      openOptions: 'Možnosti otevření',

      initialView: 'Počáteční pohled',
      auto: 'Automaticky',
      autoHint: 'Podle režimu přístupu',
      extents: 'Rozsah',
      extentsHint: 'Přizpůsobit výkres',
      saved: 'Uložený',
      savedHint: 'Uložený pohled AutoCADu',

      accessMode: 'Režim přístupu',
      read: 'Čtení',
      readHint: 'Pouze zobrazení',
      review: 'Kontrola',
      reviewHint: 'Zobrazení a kontrola',
      write: 'Zápis',
      writeHint: 'Plný přístup',

      textRendering: 'Vykreslování textu',
      worker: 'Worker',
      workerHint: 'Rychlejší, více paměti',
      mainThread: 'Hlavní vlákno',
      mainThreadHint: 'Pomalejší, méně paměti',

      progressive: 'Průběžné',
      progressiveRendering: 'Průběžné vykreslování',
      on: 'Zapnuto',
      progressiveOnHint:
        'Zamknout UI do dokončení parse/převodu; poté pan/zoom při načítání scény',
      off: 'Vypnuto',
      progressiveOffHint: 'Čekat na dokončení převodu entit i textu',

      nonPlottable: 'Netisknutelné',
      nonPlottableLayers: 'Netisknutelné hladiny',
      hide: 'Skrýt',
      hideHint: 'Výchozí pro webový prohlížeč',
      show: 'Zobrazit',
      showHint: 'Chování editoru AutoCAD',

      curveQuality: 'Kvalita křivek',
      curveDraft: 'Paměť',
      curveDraftHint: 'Méně vrcholů, menší soubory',
      curveStandard: 'Standardní',
      curveStandardHint: 'Vyvážené (100 stran na kružnici)',
      curveHigh: 'Kvalita',
      curveHighHint: 'Hladší křivky, více paměti',

      paperSpaceBackground: 'Pozadí papíru',
      paperSpaceWhite: 'Bílé',
      paperSpaceWhiteHint: 'Desktop CAD / náhled tisku',
      paperSpaceBlack: 'Černé',
      paperSpaceBlackHint: 'Preferované pro webový prohlížeč',

      export: 'Export',
      exportEnable: 'Povolit',
      exportEnableHint: 'Povolit export DXF/HTML/PDF/SVG/PNG',
      exportDisable: 'Zakázat',
      exportDisableHint: 'Skrýt příkazy exportu a položky nabídky File',

      invalidFileType:
        'Neplatný typ souboru. Nahrajte soubory DWG nebo DXF.'
    }
  }
}
