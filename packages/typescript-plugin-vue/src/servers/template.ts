import QuickLRU from 'quick-lru'
import { GOTO_PROVIDERS } from '../features/goto'
import { REFACTOR_PROVIDERS } from '../features/refactors'
import { RENAME_PROVIDERS } from '../features/renames'
import { wrapInTrace } from '../helpers/logger'
import { isNotNull } from '../helpers/utils'
import { TS } from '../interfaces'
import { LanguageServiceOptions } from '../types'
import { noop } from './noop'

interface AdditionalFunctions {
  getEditsForFileRenameIn(
    fileName: string,
    oldFilePath: string,
    newFilePath: string,
  ): TS.FileTextChanges[]
}

export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
export function createTemplateLanguageServer(
  config: LanguageServiceOptions,
): TS.LanguageService & AdditionalFunctions {
  const { helpers: h, service, context } = config

  const cache = new QuickLRU<string, any>({ maxSize: 1000 })

  return wrapInTrace('TemplateLanguageServer', {
    ...noop,

    getQuickInfoAtPosition(fileName, position) {
      const document = h.getRenderDoc(fileName)
      if (!document) return

      const loc = document.getGeneratedOffsetAt(position)
      if (!loc) return
      const result = service.getQuickInfoAtPosition(fileName, loc.offset)

      if (result) {
        const textSpan = h.getTextSpan(document, result.textSpan)
        if (textSpan) {
          result.textSpan = textSpan

          return result
        }
      }
    },

    getSemanticDiagnostics(fileName) {
      const document = h.getRenderDoc(fileName)
      if (!document) return []

      const key = `getSemanticDiagnostics::${document.container.version}::${fileName}`

      if (cache.has(key)) return cache.get(key)

      const diagnostics = service
        .getSemanticDiagnostics(fileName)
        .map((diagnostic) => {
          if (Number.isInteger(diagnostic.start)) {
            const position = document.findExpression(
              diagnostic.start!,
              diagnostic.length || 1,
            )
            if (!position) return

            diagnostic.start = position.offset
            diagnostic.length = position.length
          }

          return diagnostic
        })
        .filter(isNotNull)

      cache.set(key, diagnostics)

      return diagnostics
    },

    getSuggestionDiagnostics(fileName) {
      const document = h.getRenderDoc(fileName)
      if (!document) return []

      const key = `getSuggestionDiagnostics::${document.container.version}::${fileName}`
      if (cache.has(key)) return cache.get(key)

      const diagnostics = service
        .getSuggestionDiagnostics(fileName)
        .map((diagnostic) => {
          if (Number.isInteger(diagnostic.start)) {
            const position = document.findExpression(
              diagnostic.start!,
              diagnostic.length || 1,
            )

            if (!position) return

            diagnostic.start = position.offset
            diagnostic.length = position.length
          }

          return diagnostic
        })
        .filter(isNotNull)
      cache.set(key, diagnostics)
      return diagnostics
    },

    getSyntacticDiagnostics(fileName) {
      const document = h.getRenderDoc(fileName)
      if (!document) return []

      const key = `getSyntacticDiagnostics::${document.container.version}::${fileName}`
      if (cache.has(key)) return cache.get(key)
      const diagnostics = service
        .getSyntacticDiagnostics(fileName)
        .map((diagnostic) => {
          if (Number.isInteger(diagnostic.start)) {
            const position = document.findExpression(
              diagnostic.start!,
              diagnostic.length || 1,
            )

            if (!position) return

            diagnostic.start = position.offset
            diagnostic.length = position.length
          }

          return diagnostic
        })
        .filter(isNotNull)
      cache.set(key, diagnostics)
      return diagnostics
    },

    getRenameInfo(fileName, position, preferences = {}): TS.RenameInfo {
      for (const provider of RENAME_PROVIDERS) {
        const result = provider.canRename(
          config,
          fileName,
          position,
          preferences,
        )
        if (result != null) return result
      }

      return {
        canRename: false,
        localizedErrorMessage: 'You cannot rename this element.',
      }
    },

    findRenameLocations(fileName, position, findInStrings, findInComments) {
      for (const provider of RENAME_PROVIDERS) {
        const result = provider.applyRename(
          config,
          fileName,
          position,
          findInStrings,
          findInComments,
        )
        if (result) return result
      }

      return []
    },

    getEditsForFileRenameIn(fileName, oldFilePath, newFilePath) {
      for (const provider of RENAME_PROVIDERS) {
        const result = provider.applyFileRename(
          config,
          fileName,
          oldFilePath,
          newFilePath,
          {},
          {},
        )
        if (result) return result
      }

      return []
    },

    getApplicableRefactors(fileName, position, preferences = {}) {
      const refactors: TS.ApplicableRefactorInfo[] = []

      for (const provider of REFACTOR_PROVIDERS) {
        const result = provider.findRefactors(
          config,
          fileName,
          position,
          preferences,
        )

        if (result) refactors.push(...result)
      }

      return refactors
    },

    getEditsForRefactor(
      fileName,
      formatOptions,
      positionOrRange,
      refactorName,
      actionName,
      preferences = {},
    ) {
      for (const provider of REFACTOR_PROVIDERS) {
        const result = provider.applyRefactor(
          config,
          fileName,
          formatOptions,
          positionOrRange,
          refactorName,
          actionName,
          preferences,
        )

        if (result != null) return result
      }
    },

    getDefinitionAndBoundSpan(
      fileName,
      position,
    ): TS.DefinitionInfoAndBoundSpan | undefined {
      for (const provider of GOTO_PROVIDERS) {
        const result = provider.getDefinitionAndBoundSpan(
          config,
          fileName,
          position,
        )

        if (result != null) return result
      }
    },
  })
}
