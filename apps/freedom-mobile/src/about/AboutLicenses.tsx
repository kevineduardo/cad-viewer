// SPDX-License-Identifier: GPL-3.0-or-later

import { type ReactElement, useEffect, useState } from 'react'
import {
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'

import {
  ABOUT_SECTIONS,
  ABOUT_TITLE,
  aboutMetaRows,
  GPL_3_0_TEXT,
  GPL_BUTTON_LABEL,
  GPL_VIEW_TITLE,
  NOT_LEGAL_ADVICE,
  PENDING_PREFIX,
  splitParagraphs,
  type ThirdPartyEntry
} from './aboutContent.ts'

export interface AboutLicensesProps {
  onClose: () => void
  appVersion: string
  /** `viewerVersion` do `ready`; null enquanto o viewer não estiver pronto. */
  viewerVersion: string | null
  /** SHA de build; null se não definido. */
  buildSha: string | null
  /** Abre uma ligação fora da app, só por acção do utilizador. */
  onOpenLink?: (url: string) => void
}

type Screen =
  | { kind: 'about' }
  | { kind: 'text'; id: string; title: string; text: string }

const defaultOpenLink = (url: string): void => {
  // Falhar (sem browser, sem rede) nunca afecta o ecrã nem o viewer.
  Linking.openURL(url).catch(() => undefined)
}

export function AboutLicenses({
  onClose,
  appVersion,
  viewerVersion,
  buildSha,
  onOpenLink = defaultOpenLink
}: AboutLicensesProps): ReactElement {
  const [view, setView] = useState<Screen>({ kind: 'about' })
  const inText = view.kind === 'text'

  // Botão «Voltar» do Android: na vista de texto regressa ao Acerca; no Acerca
  // fecha o overlay (o viewer continua montado por baixo).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inText) setView({ kind: 'about' })
      else onClose()
      return true
    })
    return () => sub.remove()
  }, [inText, onClose])

  const back = () => (inText ? setView({ kind: 'about' }) : onClose())

  return (
    <View style={styles.root} accessibilityViewIsModal testID="about-root">
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            inText ? 'Voltar ao Acerca e licenças' : 'Voltar ao visualizador'
          }
          testID="about-back"
          onPress={back}
          style={styles.back}
        >
          <Text style={styles.backText}>Voltar</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {inText ? view.title : ABOUT_TITLE}
        </Text>
      </View>
      {view.kind === 'text' ? (
        <TextView text={view.text} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} testID="about-main">
          <Text style={styles.disclaimer}>{NOT_LEGAL_ADVICE}</Text>
          {ABOUT_SECTIONS.map(section => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">
                {section.title}
              </Text>
              {section.id === 'about' ? (
                <MetaRows
                  appVersion={appVersion}
                  viewerVersion={viewerVersion}
                  buildSha={buildSha}
                />
              ) : null}
              {section.paragraphs.map(p => (
                <Text key={p} style={styles.body}>
                  {p}
                </Text>
              ))}
              {section.id === 'license' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={GPL_BUTTON_LABEL}
                  testID="about-gpl-button"
                  onPress={() =>
                    setView({
                      kind: 'text',
                      id: 'gpl-3.0',
                      title: GPL_VIEW_TITLE,
                      text: GPL_3_0_TEXT
                    })
                  }
                  style={styles.action}
                >
                  <Text style={styles.actionText}>{GPL_BUTTON_LABEL}</Text>
                </Pressable>
              ) : null}
              {section.notes?.map(n => (
                <Text key={n} style={styles.note}>
                  {PENDING_PREFIX}
                  {n}
                </Text>
              ))}
              {section.items?.map(item => (
                <Entry
                  key={item.name}
                  item={item}
                  onOpenLink={onOpenLink}
                  onShowText={() =>
                    setView({
                      kind: 'text',
                      id: item.name,
                      title: `Licença — ${item.name}`,
                      text: item.text
                    })
                  }
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function MetaRows(props: {
  appVersion: string
  viewerVersion: string | null
  buildSha: string | null
}): ReactElement {
  return (
    <View style={styles.meta}>
      {aboutMetaRows(props).map(row => (
        <Text
          key={row.id}
          style={styles.body}
          testID={`about-${row.id}`}
          accessibilityLabel={`${row.label}: ${row.value}`}
        >
          {row.label}: {row.value}
        </Text>
      ))}
    </View>
  )
}

function Entry({
  item,
  onOpenLink,
  onShowText
}: {
  item: ThirdPartyEntry
  onOpenLink: (url: string) => void
  onShowText: () => void
}): ReactElement {
  const links: { label: string; url: string }[] = []
  if (item.url) links.push({ label: 'Projecto', url: item.url })
  if (item.sourceUrl && item.sourceUrl !== item.url) {
    links.push({ label: 'Fonte', url: item.sourceUrl })
  }
  if (item.wasmSourceUrl) {
    links.push({ label: 'Fonte do pacote wasm', url: item.wasmSourceUrl })
  }
  return (
    <View style={styles.item} testID={`about-entry-${item.name}`}>
      <Text style={styles.itemName}>
        {item.name} {item.version}
      </Text>
      <Text style={styles.body}>Licença: {item.license}</Text>
      {item.copyright ? (
        <Text style={styles.body}>{item.copyright}</Text>
      ) : null}
      {links.map(l => (
        <Pressable
          key={l.url}
          accessibilityRole="link"
          accessibilityLabel={`${l.label}: ${l.url}`}
          onPress={() => onOpenLink(l.url)}
          style={styles.link}
        >
          <Text style={styles.linkText} selectable>
            {l.label}: {l.url}
          </Text>
        </Pressable>
      ))}
      {item.pending.map(p => (
        <Text key={p} style={styles.note}>
          {PENDING_PREFIX}
          {p}
        </Text>
      ))}
      {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
      {item.text ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ver texto da licença de ${item.name}`}
          onPress={onShowText}
          style={styles.action}
        >
          <Text style={styles.actionText}>Ver texto da licença</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function TextView({ text }: { text: string }): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.content} testID="about-text">
      {splitParagraphs(text).map((p, i) => (
        <Text key={i} style={styles.mono} selectable>
          {p}
        </Text>
      ))}
    </ScrollView>
  )
}

export const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#ffffff'
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  back: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1a56db'
  },
  backText: { color: '#ffffff', fontSize: 16 },
  title: { fontSize: 18, fontWeight: '600', flexShrink: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  disclaimer: { fontSize: 14, color: '#444444', fontStyle: 'italic' },
  section: { gap: 8 },
  heading: { fontSize: 16, fontWeight: '600' },
  meta: { gap: 2 },
  body: { fontSize: 14, color: '#222222' },
  mono: { fontSize: 13, color: '#222222', fontFamily: 'monospace' },
  note: { fontSize: 14, color: '#444444', fontStyle: 'italic' },
  item: { gap: 4, paddingVertical: 8 },
  itemName: { fontSize: 14, fontWeight: '600' },
  action: {
    alignSelf: 'flex-start',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1a56db'
  },
  actionText: { color: '#ffffff', fontSize: 16 },
  link: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 14, color: '#1a56db', textDecorationLine: 'underline' }
})
