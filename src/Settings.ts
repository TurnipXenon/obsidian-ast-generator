import update, { Spec } from 'immutability-helper';
import { App, Modal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';

import { KanbanView } from './KanbanView';
import { StateManager } from './StateManager';
import { CloudflareConfig } from './cloudflare';
import { c } from './components/helpers';
import { DataKey, DateColor, TagColor, TagSort } from './components/types';
import { kebabize } from './helpers/util';
import { t } from './lang/helpers';
import KanbanPlugin from './main';
import { frontmatterKey } from './parsers/common';
import { parseFragment, parseMarkdown } from './parsers/parseMarkdown';
import { getListOptions } from './settingHelpers';

export type KanbanFormat = 'basic' | 'board' | 'table' | 'list';

export interface BaseFolderConfig {
  path: string; // vault-relative path
  origin?: string; // cached remote origin (read-only display, fetched at render time)
  cloudflare?: CloudflareConfig;
}

export interface KanbanSettings {
  [frontmatterKey]?: KanbanFormat;
  'append-archive-date'?: boolean;
  'archive-date-format'?: string;
  'archive-date-separator'?: string;
  'archive-with-date'?: boolean;
  'date-colors'?: DateColor[];
  'date-display-format'?: string;
  'date-format'?: string;
  'date-picker-week-start'?: number;
  'date-time-display-format'?: string;
  'date-trigger'?: string;
  'full-list-lane-width'?: boolean;
  'hide-card-count'?: boolean;
  'inline-metadata-position'?: 'body' | 'footer' | 'metadata-table';
  'lane-width'?: number;
  'link-date-to-daily-note'?: boolean;
  'list-collapse'?: boolean[];
  'max-archive-size'?: number;
  'metadata-keys'?: DataKey[];
  'move-dates'?: boolean;
  'move-tags'?: boolean;
  'move-task-metadata'?: boolean;
  'new-card-insertion-method'?: 'prepend' | 'prepend-compact' | 'append';
  'new-line-trigger'?: 'enter' | 'shift-enter';
  'new-note-folder'?: string;
  'new-note-template'?: string;
  'show-add-list'?: boolean;
  'show-archive-all'?: boolean;
  'show-board-settings'?: boolean;
  'show-checkboxes'?: boolean;
  'show-relative-date'?: boolean;
  'show-search'?: boolean;
  'show-set-view'?: boolean;
  'show-view-as-markdown'?: boolean;
  'table-sizing'?: Record<string, number>;
  'tag-action'?: 'kanban' | 'obsidian';
  'tag-colors'?: TagColor[];
  'tag-sort'?: TagSort[];
  'time-format'?: string;
  'time-trigger'?: string;

  'base-folder'?: string;
  'base-folders'?: BaseFolderConfig[];
}

export interface KanbanViewSettings {
  [frontmatterKey]?: KanbanFormat;
  'list-collapse'?: boolean[];
}

export const settingKeyLookup: Set<keyof KanbanSettings> = new Set([
  frontmatterKey,
  'append-archive-date',
  'archive-date-format',
  'archive-date-separator',
  'archive-with-date',
  'date-colors',
  'date-display-format',
  'date-format',
  'date-picker-week-start',
  'date-time-display-format',
  'date-trigger',
  'full-list-lane-width',
  'hide-card-count',
  'inline-metadata-position',
  'lane-width',
  'link-date-to-daily-note',
  'list-collapse',
  'max-archive-size',
  'metadata-keys',
  'move-dates',
  'move-tags',
  'move-task-metadata',
  'new-card-insertion-method',
  'new-line-trigger',
  'new-note-folder',
  'new-note-template',
  'show-add-list',
  'show-archive-all',
  'show-board-settings',
  'show-checkboxes',
  'show-relative-date',
  'show-search',
  'show-set-view',
  'show-view-as-markdown',
  'table-sizing',
  'tag-action',
  'tag-colors',
  'tag-sort',
  'time-format',
  'time-trigger',
]);

export type SettingRetriever = <K extends keyof KanbanSettings>(
  key: K,
  supplied?: KanbanSettings
) => KanbanSettings[K];

export interface SettingRetrievers {
  getGlobalSettings: () => KanbanSettings;
  getGlobalSetting: SettingRetriever;
  getSetting: SettingRetriever;
}

export interface SettingsManagerConfig {
  onSettingsChange: (newSettings: KanbanSettings) => void;
}

interface PathSlug {
  path: string;
  slug: string;
  preview: string;
}

class ExportedFiles extends TFile implements PathSlug {
  tags: string[];
  slug: string;
  preview: string;
}

async function getGitOrigin(repoPath: string): Promise<string> {
  return new Promise((resolve) => {
    const { exec } = (window as any).require('child_process');
    exec('git remote get-url origin', { cwd: repoPath }, (err: any, stdout: string) => {
      resolve(err ? 'not set' : stdout.trim());
    });
  });
}

export class SettingsManager {
  win: Window;
  app: App;
  plugin: KanbanPlugin;
  config: SettingsManagerConfig;
  settings: KanbanSettings;
  cleanupFns: Array<() => void> = [];
  applyDebounceTimer: number = 0;

  constructor(plugin: KanbanPlugin, config: SettingsManagerConfig, settings: KanbanSettings) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.config = config;
    this.settings = settings;
  }

  applySettingsUpdate(spec: Spec<KanbanSettings>) {
    this.win.clearTimeout(this.applyDebounceTimer);

    this.applyDebounceTimer = this.win.setTimeout(() => {
      this.settings = update(this.settings, spec);
      this.config.onSettingsChange(this.settings);
    }, 1000);
  }

  getSetting(key: keyof KanbanSettings, local: boolean) {
    if (local) {
      return [this.settings[key], this.plugin.settings[key]];
    }

    return [this.settings[key], null];
  }

  constructUI(contentEl: HTMLElement, heading: string, local: boolean) {
    this.win = contentEl.win;

    const { vaultFolders } = getListOptions(this.app);

    contentEl.createEl('h3', { text: heading });

    if (local) {
      contentEl.createEl('p', {
        text: t('These settings will take precedence over the default Kanban board settings.'),
      });
    } else {
      contentEl.createEl('p', {
        text: t(
          'Set the default Kanban board settings. Settings can be overridden on a board-by-board basis.'
        ),
      });
    }

    contentEl.createEl('h4', { text: 'Base Folders' });
    const baseFoldersContainer = contentEl.createDiv();

    const saveFolders = (newFolders: BaseFolderConfig[]) => {
      this.settings['base-folders'] = newFolders;
      this.config.onSettingsChange(this.settings);
    };

    const renderBaseFolders = () => {
      baseFoldersContainer.empty();
      const baseFolders: BaseFolderConfig[] = this.settings['base-folders'] ?? [];
      const adapter = this.app.vault.adapter as any;

      baseFolders.forEach((folder, index) => {
        const row = new Setting(baseFoldersContainer)
          .setName(folder.path || `Folder ${index + 1}`)
          .setDesc('Origin: loading…')
          .addDropdown((dropdown) => {
            dropdown.addOption('', '— select folder —');
            vaultFolders.forEach((f) => dropdown.addOption(f.value, f.label));
            dropdown.setValue(folder.path ?? '');
            dropdown.onChange((value) => {
              const updated = [...baseFolders];
              updated[index] = { ...updated[index], path: value };
              saveFolders(updated);
              row.setName(value || `Folder ${index + 1}`);
            });
          })
          .addExtraButton((btn) => {
            btn
              .setIcon('cross')
              .setTooltip('Remove')
              .onClick(() => {
                const updated = [...baseFolders];
                updated.splice(index, 1);
                saveFolders(updated);
                renderBaseFolders();
              });
          });

        if (folder.path && adapter?.basePath) {
          const absPath = `${adapter.basePath}/${folder.path}`;
          getGitOrigin(absPath).then((origin) => {
            row.setDesc(`Origin: ${origin}`);
          });
        } else {
          row.setDesc('Origin: not set');
        }

        // Cloudflare sub-settings
        const cfFields: Array<{ key: keyof CloudflareConfig; label: string; password?: boolean }> =
          [
            { key: 'accountId', label: 'Cloudflare Account ID' },
            { key: 'triggerId', label: 'Cloudflare Trigger ID' },
            { key: 'apiToken', label: 'Cloudflare API Token', password: true },
            { key: 'webRepoPath', label: 'Web Repo Path (e.g. ~/Projects/Web/speenus)' },
          ];

        cfFields.forEach(({ key, label, password }) => {
          const cfSetting = new Setting(baseFoldersContainer).setName(label).addText((text) => {
            if (password) text.inputEl.type = 'password';
            text.setValue(folder.cloudflare?.[key] ?? '');
            text.onChange((val) => {
              const currentFolders = this.settings['base-folders'] ?? [];
              const updated = [...currentFolders];
              updated[index] = {
                ...updated[index],
                cloudflare: {
                  accountId: updated[index].cloudflare?.accountId ?? '',
                  triggerId: updated[index].cloudflare?.triggerId ?? '',
                  apiToken: updated[index].cloudflare?.apiToken ?? '',
                  webRepoPath: updated[index].cloudflare?.webRepoPath ?? '',
                  [key]: val,
                },
              };
              saveFolders(updated);
            });
          });
          cfSetting.settingEl.style.paddingLeft = '2em';
        });
      });

      // Add row
      let pendingPath = '';
      new Setting(baseFoldersContainer)
        .setName('Add base folder')
        .addDropdown((dropdown) => {
          dropdown.addOption('', '— select folder —');
          vaultFolders.forEach((f) => dropdown.addOption(f.value, f.label));
          dropdown.onChange((value) => {
            pendingPath = value;
          });
        })
        .addButton((btn) => {
          btn.setButtonText('Add').onClick(() => {
            if (!pendingPath) return;

            if (adapter?.basePath) {
              const { existsSync, writeFileSync } = (window as any).require('fs');
              const absPath = `${adapter.basePath}/${pendingPath}`;
              const gitignorePath = `${absPath}/.gitignore`;
              if (!existsSync(gitignorePath)) {
                writeFileSync(gitignorePath, `*.md\n**/*.md\n.idea/\n`, 'utf8');
              }
            }

            const updated = [...(this.settings['base-folders'] ?? []), { path: pendingPath }];
            saveFolders(updated);
            renderBaseFolders();
          });
        });
    };

    renderBaseFolders();
  }

  cleanUp() {
    this.win = null;
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }

  generateAst() {
    const scanningMessage = new Notice('Please wait. Scanning Vault...', 0);

    const { vault } = this.app;
    const allFiles = vault.getFiles();
    const promises: Promise<void>[] = [];
    allFiles.forEach((file) => {
      if (file.name.endsWith('.ast.json') && !file.name.endsWith('.draft.ast.json')) {
        promises.push(vault.delete(file));
      }
    });

    const baseFolders = (this.settings['base-folders'] ?? []).map((b) => b.path);
    if (baseFolders.length === 0) {
      const legacy = this.getSetting('base-folder', true)[0] as string | undefined;
      if (legacy) baseFolders.push(legacy);
    }

    Promise.all(promises)
      .then(() => Promise.all(baseFolders.map((f) => this._generateAst(f))))
      .catch((err) => {
        new Notice('Error generating AST JSONs');
        console.error(err);
      })
      .finally(() => {
        scanningMessage.hide();
      });
  }

  private async _generateAst(baseFolder: string) {
    const { vault, metadataCache } = this.app;

    const exportedFiles: ExportedFiles[] = [];
    const metadataPath = `${baseFolder}/main.meta.json`;

    return Promise.all(
      vault.getMarkdownFiles().map(async (file) => {
        if (!file.path.startsWith(`${baseFolder}/`)) {
          return;
        }

        if (file.name.endsWith('.draft.md') || file.name.endsWith('.published.md')) return;

        const metadata = metadataCache.getFileCache(file);
        const readFile = await vault.read(file);
        const stateManager = new StateManager(this.app, this);
        stateManager.file = file;
        const ast = parseMarkdown(stateManager, readFile);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { vault: _v, parent, saving, deleted, ...wantedProps } = file as any;
        const startLen = baseFolder.length > 0 ? baseFolder.length + 1 : 0;
        const savePath = `${file.path.substring(0, file.path.length - 3)}.ast.json`;
        wantedProps.path = savePath.substring(startLen);

        let preview = undefined;
        if (metadata.frontmatter?.preview) {
          const fragment = parseFragment(stateManager, metadata.frontmatter.preview);
          const children = (fragment.children[0] as any).children;
          if (children) {
            const target: string | undefined = children[0].fileAccessor?.target;
            if (target) {
              const imageFile = metadataCache.getFirstLinkpathDest(target, file.path);
              if (imageFile) {
                const prefix = baseFolder + '/';
                preview = imageFile.path.startsWith(prefix)
                  ? imageFile.path.slice(prefix.length)
                  : imageFile.path;
              }
            }
          }
        }

        const fileData = {
          ...wantedProps,
          ...ast.frontmatter,
          tags: ast.frontmatter?.tags ?? [],
          slug: ast.frontmatter?.slug ?? kebabize(file.basename),
          preview,
        };
        const jsonFile = {
          ...fileData,
          ast,
        };
        exportedFiles.push(fileData);
        return vault.create(
          savePath,
          JSON.stringify(
            jsonFile,
            (key, value) => {
              if (['position', 'extension'].includes(key)) {
                return undefined;
              }
              return value;
            },
            2
          )
        );
      })
    )
      .then(() => {
        const tfile = vault.getFileByPath(metadataPath);
        if (tfile === null) {
          return;
        }

        return vault.delete(tfile);
      })
      .then(() => {
        const tagMap = new Map<string, PathSlug[] | undefined>();
        exportedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
        exportedFiles.forEach((file) => {
          file.tags.forEach((tag) => {
            let tagCollection = tagMap.get(tag);
            if (tagCollection === undefined) {
              tagCollection = [];
            }
            console.log('v3,', file.preview);
            tagCollection.push({
              path: file.path,
              slug: file.slug,
              preview: file.preview,
            });
            tagMap.set(tag, tagCollection);
          });
        });

        const tags: { name: string; entries: PathSlug[] }[] = [];
        tagMap.forEach((value, key) => {
          tags.push({
            name: key,
            entries: value,
          });
        });

        const mainMeta = {
          files: exportedFiles,
          tags,
        };

        return vault.create(metadataPath, JSON.stringify(mainMeta, undefined, 2));
      })
      .then(() => new Notice('AST JSONs generated'));
  }

  private getBaseFolderForFile(file: TFile): string | null {
    const baseFolders = (this.settings['base-folders'] ?? []).map((b) => b.path);
    if (baseFolders.length === 0) {
      const legacy = this.getSetting('base-folder', true)[0] as string | undefined;
      if (legacy) baseFolders.push(legacy);
    }
    return baseFolders.find((f) => file.path.startsWith(`${f}/`)) ?? null;
  }

  private async _generateAstForFile(
    file: TFile,
    baseFolder: string
  ): Promise<{ jsonFile: object; readFile: string }> {
    const { vault, metadataCache } = this.app;
    const metadata = metadataCache.getFileCache(file);
    const readFile = await vault.read(file);
    const stateManager = new StateManager(this.app, this);
    stateManager.file = file;
    const ast = parseMarkdown(stateManager, readFile);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vault: _v, parent, saving, deleted, ...wantedProps } = file as any;
    const startLen = baseFolder.length > 0 ? baseFolder.length + 1 : 0;
    const savePath = `${file.path.substring(0, file.path.length - 3)}.ast.json`;
    wantedProps.path = savePath.substring(startLen);

    let preview = undefined;
    if (metadata?.frontmatter?.preview) {
      const fragment = parseFragment(stateManager, metadata.frontmatter.preview);
      const children = (fragment.children[0] as any).children;
      if (children) {
        const target: string | undefined = children[0].fileAccessor?.target;
        if (target) {
          const imageFile = metadataCache.getFirstLinkpathDest(target, file.path);
          if (imageFile) {
            const prefix = baseFolder + '/';
            preview = imageFile.path.startsWith(prefix)
              ? imageFile.path.slice(prefix.length)
              : imageFile.path;
          }
        }
      }
    }

    const fileData = {
      ...wantedProps,
      ...ast.frontmatter,
      tags: ast.frontmatter?.tags ?? [],
      slug: ast.frontmatter?.slug ?? kebabize(file.basename),
      preview,
    };

    return { jsonFile: { ...fileData, ast }, readFile };
  }

  async saveAsDraft(file: TFile) {
    const baseFolder = this.getBaseFolderForFile(file);
    if (!baseFolder) {
      new Notice('File is not inside a configured base folder.');
      return;
    }
    const notice = new Notice('Saving as draft…', 0);
    const { vault } = this.app;

    try {
      const { jsonFile, readFile } = await this._generateAstForFile(file, baseFolder);
      const stem = file.path.substring(0, file.path.length - 3);

      const draftAstPath = `${stem}.draft.ast.json`;
      const draftAstFile = vault.getFileByPath(draftAstPath);
      if (draftAstFile) {
        await vault.modify(
          draftAstFile,
          JSON.stringify(
            jsonFile,
            (k, v) => (['position', 'extension'].includes(k) ? undefined : v),
            2
          )
        );
      } else {
        await vault.create(
          draftAstPath,
          JSON.stringify(
            jsonFile,
            (k, v) => (['position', 'extension'].includes(k) ? undefined : v),
            2
          )
        );
      }

      const draftMdPath = `${stem}.draft.md`;
      const draftMdFile = vault.getFileByPath(draftMdPath);
      if (draftMdFile) {
        await vault.modify(draftMdFile, readFile);
      } else {
        await vault.create(draftMdPath, readFile);
      }

      notice.hide();
      new Notice(`Saved as draft: ${file.basename}`);
    } catch (err) {
      notice.hide();
      new Notice('Error saving as draft.');
      console.error(err);
    }
  }

  async saveAsPublished(file: TFile) {
    const baseFolder = this.getBaseFolderForFile(file);
    if (!baseFolder) {
      new Notice('File is not inside a configured base folder.');
      return;
    }
    const notice = new Notice('Saving as published…', 0);
    const { vault } = this.app;

    try {
      const { jsonFile, readFile } = await this._generateAstForFile(file, baseFolder);
      const stem = file.path.substring(0, file.path.length - 3);
      const startLen = baseFolder.length > 0 ? baseFolder.length + 1 : 0;

      const astPath = `${stem}.ast.json`;
      const astFile = vault.getFileByPath(astPath);
      const astJson = JSON.stringify(
        jsonFile,
        (k, v) => (['position', 'extension'].includes(k) ? undefined : v),
        2
      );
      if (astFile) {
        await vault.modify(astFile, astJson);
      } else {
        await vault.create(astPath, astJson);
      }

      const publishedMdPath = `${stem}.published.md`;
      const publishedMdFile = vault.getFileByPath(publishedMdPath);
      if (publishedMdFile) {
        await vault.modify(publishedMdFile, readFile);
      } else {
        await vault.create(publishedMdPath, readFile);
      }

      // Update main.meta.json
      const metadataPath = `${baseFolder}/main.meta.json`;
      const fileData: any = { ...(jsonFile as any) };
      delete fileData.ast;
      fileData.path = astPath.substring(startLen);

      let existingMeta: { files: any[]; tags: any[] } = { files: [], tags: [] };
      const metaFile = vault.getFileByPath(metadataPath);
      if (metaFile) {
        try {
          existingMeta = JSON.parse(await vault.read(metaFile));
        } catch {
          // use default
        }
      }

      const existingIdx = existingMeta.files.findIndex((f: any) => f.path === fileData.path);
      if (existingIdx >= 0) {
        existingMeta.files[existingIdx] = fileData;
      } else {
        existingMeta.files.push(fileData);
      }

      existingMeta.files.sort((a: any, b: any) => b.stat.mtime - a.stat.mtime);

      const tagMap = new Map<string, PathSlug[]>();
      existingMeta.files.forEach((f: any) => {
        (f.tags ?? []).forEach((tag: string) => {
          let col = tagMap.get(tag);
          if (!col) col = [];
          col.push({ path: f.path, slug: f.slug, preview: f.preview });
          tagMap.set(tag, col);
        });
      });

      const tags: { name: string; entries: PathSlug[] }[] = [];
      tagMap.forEach((value, key) => tags.push({ name: key, entries: value }));

      const newMeta = { files: existingMeta.files, tags };
      const newMetaJson = JSON.stringify(newMeta, undefined, 2);

      if (metaFile) {
        await vault.modify(metaFile, newMetaJson);
      } else {
        await vault.create(metadataPath, newMetaJson);
      }

      notice.hide();
      new Notice(`Saved as published: ${file.basename}`);
    } catch (err) {
      notice.hide();
      new Notice('Error saving as published.');
      console.error(err);
    }
  }
}

export class SettingsModal extends Modal {
  view: KanbanView;
  settingsManager: SettingsManager;

  constructor(view: KanbanView, config: SettingsManagerConfig, settings: KanbanSettings) {
    super(view.app);

    this.view = view;
    this.settingsManager = new SettingsManager(view.plugin, config, settings);
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    modalEl.addClass(c('board-settings-modal'));

    this.settingsManager.constructUI(contentEl, this.view.file.basename, true);
  }

  onClose() {
    const { contentEl } = this;

    this.settingsManager.cleanUp();
    contentEl.empty();
  }
}

export class KanbanSettingsTab extends PluginSettingTab {
  plugin: KanbanPlugin;
  settingsManager: SettingsManager;

  constructor(plugin: KanbanPlugin, config: SettingsManagerConfig) {
    super(plugin.app, plugin);
    this.plugin = plugin;
    this.settingsManager = new SettingsManager(plugin, config, plugin.settings);
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.addClass(c('board-settings-modal'));

    this.settingsManager.constructUI(containerEl, t("Turnip's Blog Publisher Plugin"), false);
  }
}
