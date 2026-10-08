<template>
  <div class="ml-find-palette" data-testid="find-palette">
    <div class="ml-find-form">
      <el-input
        ref="inputRef"
        v-model="find.query.value"
        clearable
        size="small"
        class="ml-find-input"
        data-testid="find-input"
        :placeholder="t('main.toolPalette.find.placeholder')"
        :aria-label="t('main.toolPalette.find.input')"
        @keydown.enter.prevent="onEnter"
        @keyup.stop
      />
      <el-button
        size="small"
        type="primary"
        data-testid="find-button"
        @click="find.search()"
      >
        {{ t('main.toolPalette.find.find') }}
      </el-button>
    </div>

    <div class="ml-find-options">
      <el-checkbox
        v-model="find.matchCase.value"
        size="small"
        data-testid="find-match-case"
        @change="find.refresh()"
      >
        {{ t('main.toolPalette.find.matchCase') }}
      </el-checkbox>
      <el-checkbox
        v-model="find.currentLayoutOnly.value"
        size="small"
        data-testid="find-current-layout-only"
        @change="find.refresh()"
      >
        {{ t('main.toolPalette.find.currentLayoutOnly') }}
      </el-checkbox>
    </div>

    <div
      class="ml-find-status"
      data-testid="find-status"
      role="status"
      aria-live="polite"
    >
      {{ statusText }}
    </div>

    <ul class="ml-find-list" data-testid="find-list">
      <li
        v-for="(hit, index) in find.hits.value"
        :key="`${hit.layoutId}:${hit.textEntityId}`"
        class="ml-find-row"
        :class="{ 'is-selected': index === find.activeIndex.value }"
        tabindex="0"
        data-testid="find-row"
        :data-layout-id="hit.layoutId"
        :data-entity-id="hit.entityId"
        @click="find.navigateTo(index)"
        @keydown.enter.space.prevent="find.navigateTo(index)"
      >
        <div
          class="ml-find-layout"
          data-testid="find-row-layout"
          :title="hit.layoutName"
        >
          {{ hit.layoutName }}
        </div>
        <div class="ml-find-text" :title="hit.text">
          {{
            acapFindExcerpt(hit.text, find.query.value, find.matchCase.value)
          }}
        </div>
        <div class="ml-find-meta">{{ describeHit(hit) }}</div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import {
  AcApDocManager,
  acapFindExcerpt,
  type AcApFindLayoutHit
} from '@mlightcad/cad-simple-viewer'
import { ElButton, ElCheckbox, ElInput } from 'element-plus'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { store } from '../../app'
import { useFind } from '../../composable/useFind'

const { t } = useI18n()
const find = useFind(AcApDocManager.instance)
const inputRef = ref<InstanceType<typeof ElInput> | null>(null)

const round = (value: number) => String(Math.round(value * 100) / 100)

/** Localized hit type (static keys: the i18n lint forbids dynamic ones). */
const kindLabel = (kind: AcApFindLayoutHit['kind']) =>
  kind === 'mtext'
    ? t('main.toolPalette.find.kind.mtext')
    : kind === 'attribute'
      ? t('main.toolPalette.find.kind.attribute')
      : t('main.toolPalette.find.kind.text')

/** `Type · layer · (x, y)` label for a hit (same format as cad-simple-ui-plugin). */
const describeHit = (hit: AcApFindLayoutHit) => {
  let kind = kindLabel(hit.kind)
  if (hit.kind === 'attribute') {
    const owner = [hit.blockName, hit.tag].filter(Boolean).join(' / ')
    if (owner) kind = `${kind} ${owner}`
  }
  return `${kind} · ${hit.layer} · (${round(hit.position.x)}, ${round(hit.position.y)})`
}

const statusText = computed(() => {
  const state = find.state.value
  if (state === 'no-document') return t('main.toolPalette.find.noDocument')
  if (state === 'idle') {
    return find.scope.value === 'layout'
      ? t('main.toolPalette.find.hintLayout')
      : t('main.toolPalette.find.hint')
  }
  const count = find.hits.value.length
  if (count === 0) return t('main.toolPalette.find.noResults')
  const params = { count, layouts: find.layoutCount.value }
  const text = find.truncated.value
    ? t('main.toolPalette.find.countTruncated', params)
    : find.layoutCount.value > 1
      ? t('main.toolPalette.find.countLayouts', params)
      : t('main.toolPalette.find.count', params)
  return find.unavailableLayout.value
    ? `${text} — ${t('main.toolPalette.find.layoutUnavailable', {
        layout: find.unavailableLayout.value
      })}`
    : text
})

const onEnter = (event: KeyboardEvent) => {
  void find.submit(event.shiftKey)
}

const focusInput = async () => {
  await nextTick()
  const el = inputRef.value?.$el?.querySelector('input') as
    | HTMLInputElement
    | undefined
  el?.focus()
  el?.select()
  // A ribbon button / overflow popup that triggered FIND takes focus back as
  // it closes; focus once more after it settles.
  setTimeout(() => {
    if (document.activeElement !== el) {
      el?.focus()
      el?.select()
    }
  }, 150)
}

watch(() => store.dialogs.findFocusTick, focusInput)
onMounted(focusInput)
</script>

<style scoped>
.ml-find-palette {
  font-size: 13px;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}

.ml-find-form {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ml-find-input {
  flex: 1;
  min-width: 0;
}

.ml-find-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  flex-shrink: 0;
}

.ml-find-options :deep(.el-checkbox) {
  height: auto;
}

.ml-find-status {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.ml-find-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.ml-find-row {
  padding: 6px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
}

.ml-find-row:hover {
  background: var(--el-fill-color-light);
}

.ml-find-row.is-selected {
  background: var(--el-color-primary-light-9);
}

.ml-find-layout,
.ml-find-meta {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-find-layout {
  font-weight: 600;
}

.ml-find-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
