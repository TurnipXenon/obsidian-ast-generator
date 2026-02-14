import update, { Spec } from 'immutability-helper';
import {
  App,
  DropdownComponent,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  TFile,
  ToggleComponent,
} from 'obsidian';

import { KanbanView } from './KanbanView';
import { StateManager } from './StateManager';
import {
  c,
  generateInstanceId,
  getDefaultDateFormat,
  getDefaultTimeFormat,
} from './components/helpers';
import {
  DataKey,
  DateColor,
  DateColorSetting,
  DateColorSettingTemplate,
  MetadataSetting,
  MetadataSettingTemplate,
  TagColor,
  TagColorSetting,
  TagColorSettingTemplate,
  TagSort,
  TagSortSetting,
  TagSortSettingTemplate,
} from './components/types';
import { getParentWindow } from './dnd/util/getWindow';
import { kebabize } from './helpers/util';
import { t } from './lang/helpers';
import { CloudflareConfig } from './cloudflare';
import KanbanPlugin from './main';
import { frontmatterKey } from './parsers/common';
import { parseFragment, parseMarkdown } from './parsers/parseMarkdown';
import {
  createSearchSelect,
  defaultDateTrigger,
  defaultMetadataPosition,
  defaultTimeTrigger,
  getListOptions,
} from './settingHelpers';
import { cleanUpDateSettings, renderDateSettings } from './settings/DateColorSettings';
import { cleanupMetadataSettings, renderMetadataSettings } from './settings/MetadataSettings';
import { cleanUpTagSettings, renderTagSettings } from './settings/TagColorSettings';
import { cleanUpTagSortSettings, renderTagSortSettings } from './settings/TagSortSettings';

const numberRegEx = /^\d+(?:\.\d+)?$/;

export type KanbanFormat = 'basic' | 'board' | 'table' | 'list';

export interface BaseFolderConfig {
  path: string;     // vault-relative path
  origin?: string;  // cached remote origin (read-only display, fetched at render time)
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

    const { templateFiles, vaultFolders, templateWarning } = getListOptions(this.app);

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
            btn.setIcon('cross').setTooltip('Remove').onClick(() => {
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
        const cfFields: Array<{ key: keyof CloudflareConfig; label: string; password?: boolean }> = [
          { key: 'accountId', label: 'Cloudflare Account ID' },
          { key: 'projectName', label: 'Cloudflare Project Name' },
          { key: 'apiToken', label: 'Cloudflare API Token', password: true },
        ];

        cfFields.forEach(({ key, label, password }) => {
          const cfSetting = new Setting(baseFoldersContainer)
            .setName(label)
            .addText((text) => {
              if (password) text.inputEl.type = 'password';
              text.setValue(folder.cloudflare?.[key] ?? '');
              text.onChange((val) => {
                const currentFolders = this.settings['base-folders'] ?? [];
                const updated = [...currentFolders];
                updated[index] = {
                  ...updated[index],
                  cloudflare: {
                    accountId: updated[index].cloudflare?.accountId ?? '',
                    projectName: updated[index].cloudflare?.projectName ?? '',
                    apiToken: updated[index].cloudflare?.apiToken ?? '',
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

    new Setting(contentEl)
      .setName('Generate metadata')
      .setDesc('Generate *.ast.json')
      .addButton((btn) => btn.setButtonText('Generate').onClick(this.generateAst));

    new Setting(contentEl)
      .setName(t('Display card checkbox'))
      .setDesc(t('When toggled, a checkbox will be displayed with each card'))
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('show-checkboxes', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'show-checkboxes': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('show-checkboxes', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['show-checkboxes'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('New line trigger'))
      .setDesc(
        t(
          'Select whether Enter or Shift+Enter creates a new line. The opposite of what you choose will create and complete editing of cards and lists.'
        )
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('shift-enter', t('Shift + Enter'));
        dropdown.addOption('enter', t('Enter'));

        const [value, globalValue] = this.getSetting('new-line-trigger', local);

        dropdown.setValue((value as string) || (globalValue as string) || 'shift-enter');
        dropdown.onChange((value) => {
          this.applySettingsUpdate({
            'new-line-trigger': {
              $set: value as 'enter' | 'shift-enter',
            },
          });
        });
      });

    new Setting(contentEl)
      .setName(t('Prepend / append new cards'))
      .setDesc(
        t('This setting controls whether new cards are added to the beginning or end of the list.')
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('prepend', t('Prepend'));
        dropdown.addOption('prepend-compact', t('Prepend (compact)'));
        dropdown.addOption('append', t('Append'));

        const [value, globalValue] = this.getSetting('new-card-insertion-method', local);

        dropdown.setValue((value as string) || (globalValue as string) || 'append');
        dropdown.onChange((value) => {
          this.applySettingsUpdate({
            'new-card-insertion-method': {
              $set: value as 'prepend' | 'append',
            },
          });
        });
      });

    new Setting(contentEl)
      .setName(t('Hide card counts in list titles'))
      .setDesc(t('When toggled, card counts are hidden from the list title'))
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('hide-card-count', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'hide-card-count': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('hide-card-count', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['hide-card-count'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('List width'))
      .setDesc(t('Enter a number to set the list width in pixels.'))
      .addText((text) => {
        const [value, globalValue] = this.getSetting('lane-width', local);

        text.inputEl.setAttr('type', 'number');
        text.inputEl.placeholder = `${globalValue ? globalValue : '272'} (default)`;
        text.inputEl.value = value ? value.toString() : '';

        text.onChange((val) => {
          if (val && numberRegEx.test(val)) {
            text.inputEl.removeClass('error');

            this.applySettingsUpdate({
              'lane-width': {
                $set: parseInt(val),
              },
            });

            return;
          }

          if (val) {
            text.inputEl.addClass('error');
          }

          this.applySettingsUpdate({
            $unset: ['lane-width'],
          });
        });
      });

    new Setting(contentEl).setName(t('Expand lists to full width in list view')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('full-list-lane-width', local);

          if (value !== undefined) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined) {
            toggle.setValue(globalValue as boolean);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'full-list-lane-width': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('full-list-lane-width', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['full-list-lane-width'],
              });
            });
        });
    });

    new Setting(contentEl)
      .setName(t('Maximum number of archived cards'))
      .setDesc(
        t(
          "Archived cards can be viewed in markdown mode. This setting will begin removing old cards once the limit is reached. Setting this value to -1 will allow a board's archive to grow infinitely."
        )
      )
      .addText((text) => {
        const [value, globalValue] = this.getSetting('max-archive-size', local);

        text.inputEl.setAttr('type', 'number');
        text.inputEl.placeholder = `${globalValue ? globalValue : '-1'} (default)`;
        text.inputEl.value = value ? value.toString() : '';

        text.onChange((val) => {
          if (val && numberRegEx.test(val)) {
            text.inputEl.removeClass('error');

            this.applySettingsUpdate({
              'max-archive-size': {
                $set: parseInt(val),
              },
            });

            return;
          }

          if (val) {
            text.inputEl.addClass('error');
          }

          this.applySettingsUpdate({
            $unset: ['max-archive-size'],
          });
        });
      });

    new Setting(contentEl)
      .setName(t('Note template'))
      .setDesc(t('This template will be used when creating new notes from Kanban cards.'))
      .then(
        createSearchSelect({
          choices: templateFiles,
          key: 'new-note-template',
          warningText: templateWarning,
          local,
          placeHolderStr: t('No template'),
          manager: this,
        })
      );

    contentEl.createEl('h4', { text: t('Tags') });

    new Setting(contentEl)
      .setName(t('Move tags to card footer'))
      .setDesc(
        t("When toggled, tags will be displayed in the card's footer instead of the card's body.")
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('move-tags', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'move-tags': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('move-tags', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['move-tags'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('Tag click action'))
      .setDesc(
        t(
          'This setting controls whether clicking the tags displayed below the card title opens the Obsidian search or the Kanban board search.'
        )
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('kanban', t('Search Kanban Board'));
        dropdown.addOption('obsidian', t('Search Obsidian Vault'));

        const [value, globalValue] = this.getSetting('tag-action', local);

        dropdown.setValue((value as string) || (globalValue as string) || 'obsidian');
        dropdown.onChange((value) => {
          this.applySettingsUpdate({
            'tag-action': {
              $set: value as 'kanban' | 'obsidian',
            },
          });
        });
      });

    new Setting(contentEl).then((setting) => {
      const [value, globalValue] = this.getSetting('tag-sort', local);

      const keys: TagSortSetting[] = ((value || globalValue || []) as TagSort[]).map((k) => {
        return {
          ...TagSortSettingTemplate,
          id: generateInstanceId(),
          data: k,
        };
      });

      renderTagSortSettings(setting.settingEl, contentEl, keys, (keys: TagSortSetting[]) =>
        this.applySettingsUpdate({
          'tag-sort': {
            $set: keys.map((k) => k.data),
          },
        })
      );

      this.cleanupFns.push(() => {
        if (setting.settingEl) {
          cleanUpTagSortSettings(setting.settingEl);
        }
      });
    });

    new Setting(contentEl).then((setting) => {
      const [value] = this.getSetting('tag-colors', local);

      const keys: TagColorSetting[] = ((value || []) as TagColor[]).map((k) => {
        return {
          ...TagColorSettingTemplate,
          id: generateInstanceId(),
          data: k,
        };
      });

      renderTagSettings(setting.settingEl, keys, (keys: TagColorSetting[]) =>
        this.applySettingsUpdate({
          'tag-colors': {
            $set: keys.map((k) => k.data),
          },
        })
      );

      this.cleanupFns.push(() => {
        if (setting.settingEl) {
          cleanUpTagSettings(setting.settingEl);
        }
      });
    });

    contentEl.createEl('h4', { text: t('Date & Time') });

    new Setting(contentEl)
      .setName(t('Move dates to card footer'))
      .setDesc(
        t("When toggled, dates will be displayed in the card's footer instead of the card's body.")
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('move-dates', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'move-dates': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('move-dates', local);
                toggleComponent.setValue((globalValue as boolean) ?? true);

                this.applySettingsUpdate({
                  $unset: ['move-dates'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('Date trigger'))
      .setDesc(t('When this is typed, it will trigger the date selector'))
      .addText((text) => {
        const [value, globalValue] = this.getSetting('date-trigger', local);

        if (value || globalValue) {
          text.setValue((value || globalValue) as string);
        }

        text.setPlaceholder((globalValue as string) || defaultDateTrigger);

        text.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'date-trigger': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['date-trigger'],
            });
          }
        });
      });

    new Setting(contentEl)
      .setName(t('Time trigger'))
      .setDesc(t('When this is typed, it will trigger the time selector'))
      .addText((text) => {
        const [value, globalValue] = this.getSetting('time-trigger', local);

        if (value || globalValue) {
          text.setValue((value || globalValue) as string);
        }

        text.setPlaceholder((globalValue as string) || defaultTimeTrigger);

        text.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'time-trigger': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['time-trigger'],
            });
          }
        });
      });

    new Setting(contentEl).setName(t('Date format')).then((setting) => {
      setting.addMomentFormat((mf) => {
        setting.descEl.appendChild(
          createFragment((frag) => {
            frag.appendText(t('This format will be used when saving dates in markdown.'));
            frag.createEl('br');
            frag.appendText(t('For more syntax, refer to') + ' ');
            frag.createEl(
              'a',
              {
                text: t('format reference'),
                href: 'https://momentjs.com/docs/#/displaying/format/',
              },
              (a) => {
                a.setAttr('target', '_blank');
              }
            );
            frag.createEl('br');
            frag.appendText(t('Your current syntax looks like this') + ': ');
            mf.setSampleEl(frag.createEl('b', { cls: 'u-pop' }));
            frag.createEl('br');
          })
        );

        const [value, globalValue] = this.getSetting('date-format', local);
        const defaultFormat = getDefaultDateFormat(this.app);

        mf.setPlaceholder(defaultFormat);
        mf.setDefaultFormat(defaultFormat);

        if (value || globalValue) {
          mf.setValue((value || globalValue) as string);
        }

        mf.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'date-format': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['date-format'],
            });
          }
        });
      });
    });

    new Setting(contentEl).setName(t('Time format')).then((setting) => {
      setting.addMomentFormat((mf) => {
        setting.descEl.appendChild(
          createFragment((frag) => {
            frag.appendText(t('For more syntax, refer to') + ' ');
            frag.createEl(
              'a',
              {
                text: t('format reference'),
                href: 'https://momentjs.com/docs/#/displaying/format/',
              },
              (a) => {
                a.setAttr('target', '_blank');
              }
            );
            frag.createEl('br');
            frag.appendText(t('Your current syntax looks like this') + ': ');
            mf.setSampleEl(frag.createEl('b', { cls: 'u-pop' }));
            frag.createEl('br');
          })
        );

        const [value, globalValue] = this.getSetting('time-format', local);
        const defaultFormat = getDefaultTimeFormat(this.app);

        mf.setPlaceholder(defaultFormat);
        mf.setDefaultFormat(defaultFormat);

        if (value || globalValue) {
          mf.setValue((value || globalValue) as string);
        }

        mf.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'time-format': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['time-format'],
            });
          }
        });
      });
    });

    new Setting(contentEl).setName(t('Date display format')).then((setting) => {
      setting.addMomentFormat((mf) => {
        setting.descEl.appendChild(
          createFragment((frag) => {
            frag.appendText(t('This format will be used when displaying dates in Kanban cards.'));
            frag.createEl('br');
            frag.appendText(t('For more syntax, refer to') + ' ');
            frag.createEl(
              'a',
              {
                text: t('format reference'),
                href: 'https://momentjs.com/docs/#/displaying/format/',
              },
              (a) => {
                a.setAttr('target', '_blank');
              }
            );
            frag.createEl('br');
            frag.appendText(t('Your current syntax looks like this') + ': ');
            mf.setSampleEl(frag.createEl('b', { cls: 'u-pop' }));
            frag.createEl('br');
          })
        );

        const [value, globalValue] = this.getSetting('date-display-format', local);
        const defaultFormat = getDefaultDateFormat(this.app);

        mf.setPlaceholder(defaultFormat);
        mf.setDefaultFormat(defaultFormat);

        if (value || globalValue) {
          mf.setValue((value || globalValue) as string);
        }

        mf.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'date-display-format': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['date-display-format'],
            });
          }
        });
      });
    });

    new Setting(contentEl)
      .setName(t('Show relative date'))
      .setDesc(
        t(
          "When toggled, cards will display the distance between today and the card's date. eg. 'In 3 days', 'A month ago'. Relative dates will not be shown for dates from the Tasks and Dataview plugins."
        )
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('show-relative-date', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'show-relative-date': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('show-relative-date', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['show-relative-date'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('Link dates to daily notes'))
      .setDesc(t('When toggled, dates will link to daily notes. Eg. [[2021-04-26]]'))
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('link-date-to-daily-note', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'link-date-to-daily-note': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('link-date-to-daily-note', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['link-date-to-daily-note'],
                });
              });
          });
      });

    new Setting(contentEl).then((setting) => {
      const [value] = this.getSetting('date-colors', local);

      const keys: DateColorSetting[] = ((value || []) as DateColor[]).map((k) => {
        return {
          ...DateColorSettingTemplate,
          id: generateInstanceId(),
          data: k,
        };
      });

      renderDateSettings(
        setting.settingEl,
        keys,
        (keys: DateColorSetting[]) =>
          this.applySettingsUpdate({
            'date-colors': {
              $set: keys.map((k) => k.data),
            },
          }),
        () => {
          const [value, globalValue] = this.getSetting('date-display-format', local);
          const defaultFormat = getDefaultDateFormat(this.app);
          return value || globalValue || defaultFormat;
        },
        () => {
          const [value, globalValue] = this.getSetting('time-format', local);
          const defaultFormat = getDefaultTimeFormat(this.app);
          return value || globalValue || defaultFormat;
        }
      );

      this.cleanupFns.push(() => {
        if (setting.settingEl) {
          cleanUpDateSettings(setting.settingEl);
        }
      });
    });

    new Setting(contentEl)
      .setName(t('Add date and time to archived cards'))
      .setDesc(
        t(
          'When toggled, the current date and time will be added to the card title when it is archived. Eg. - [ ] 2021-05-14 10:00am My card title'
        )
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('archive-with-date', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'archive-with-date': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('archive-with-date', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['archive-with-date'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('Add archive date/time after card title'))
      .setDesc(
        t(
          'When toggled, the archived date/time will be added after the card title, e.g.- [ ] My card title 2021-05-14 10:00am. By default, it is inserted before the title.'
        )
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('append-archive-date', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'append-archive-date': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('append-archive-date', local);
                toggleComponent.setValue(!!globalValue);

                this.applySettingsUpdate({
                  $unset: ['append-archive-date'],
                });
              });
          });
      });

    new Setting(contentEl)
      .setName(t('Archive date/time separator'))
      .setDesc(t('This will be used to separate the archived date/time from the title'))
      .addText((text) => {
        const [value, globalValue] = this.getSetting('archive-date-separator', local);

        text.inputEl.placeholder = globalValue ? `${globalValue} (default)` : '';
        text.inputEl.value = value ? (value as string) : '';

        text.onChange((val) => {
          if (val) {
            this.applySettingsUpdate({
              'archive-date-separator': {
                $set: val,
              },
            });

            return;
          }

          this.applySettingsUpdate({
            $unset: ['archive-date-separator'],
          });
        });
      });

    new Setting(contentEl).setName(t('Archive date/time format')).then((setting) => {
      setting.addMomentFormat((mf) => {
        setting.descEl.appendChild(
          createFragment((frag) => {
            frag.appendText(t('For more syntax, refer to') + ' ');
            frag.createEl(
              'a',
              {
                text: t('format reference'),
                href: 'https://momentjs.com/docs/#/displaying/format/',
              },
              (a) => {
                a.setAttr('target', '_blank');
              }
            );
            frag.createEl('br');
            frag.appendText(t('Your current syntax looks like this') + ': ');
            mf.setSampleEl(frag.createEl('b', { cls: 'u-pop' }));
            frag.createEl('br');
          })
        );

        const [value, globalValue] = this.getSetting('archive-date-format', local);

        const [dateFmt, globalDateFmt] = this.getSetting('date-format', local);
        const defaultDateFmt = dateFmt || globalDateFmt || getDefaultDateFormat(this.app);
        const [timeFmt, globalTimeFmt] = this.getSetting('time-format', local);
        const defaultTimeFmt = timeFmt || globalTimeFmt || getDefaultTimeFormat(this.app);

        const defaultFormat = `${defaultDateFmt} ${defaultTimeFmt}`;

        mf.setPlaceholder(defaultFormat);
        mf.setDefaultFormat(defaultFormat);

        if (value || globalValue) {
          mf.setValue((value || globalValue) as string);
        }

        mf.onChange((newValue) => {
          if (newValue) {
            this.applySettingsUpdate({
              'archive-date-format': {
                $set: newValue,
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['archive-date-format'],
            });
          }
        });
      });
    });

    new Setting(contentEl)
      .setName(t('Calendar: first day of week'))
      .setDesc(t('Override which day is used as the start of the week'))
      .addDropdown((dropdown) => {
        dropdown.addOption('', t('default'));
        dropdown.addOption('0', t('Sunday'));
        dropdown.addOption('1', t('Monday'));
        dropdown.addOption('2', t('Tuesday'));
        dropdown.addOption('3', t('Wednesday'));
        dropdown.addOption('4', t('Thursday'));
        dropdown.addOption('5', t('Friday'));
        dropdown.addOption('6', t('Saturday'));

        const [value, globalValue] = this.getSetting('date-picker-week-start', local);

        dropdown.setValue(value?.toString() || globalValue?.toString() || '');
        dropdown.onChange((value) => {
          if (value) {
            this.applySettingsUpdate({
              'date-picker-week-start': {
                $set: Number(value),
              },
            });
          } else {
            this.applySettingsUpdate({
              $unset: ['date-picker-week-start'],
            });
          }
        });
      });

    contentEl.createEl('br');
    contentEl.createEl('h4', { text: t('Inline Metadata') });

    new Setting(contentEl)
      .setName(t('Inline metadata position'))
      .setDesc(
        t('Controls where the inline metadata (from the Dataview plugin) will be displayed.')
      )
      .then((s) => {
        let input: DropdownComponent;

        s.addDropdown((dropdown) => {
          input = dropdown;

          dropdown.addOption('body', t('Card body'));
          dropdown.addOption('footer', t('Card footer'));
          dropdown.addOption('metadata-table', t('Merge with linked page metadata'));

          const [value, globalValue] = this.getSetting('inline-metadata-position', local);

          dropdown.setValue(
            value?.toString() || globalValue?.toString() || defaultMetadataPosition
          );
          dropdown.onChange((value: 'body' | 'footer' | 'metadata-table') => {
            if (value) {
              this.applySettingsUpdate({
                'inline-metadata-position': {
                  $set: value,
                },
              });
            } else {
              this.applySettingsUpdate({
                $unset: ['inline-metadata-position'],
              });
            }
          });
        }).addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('inline-metadata-position', local);
              input.setValue((globalValue as string) || defaultMetadataPosition);

              this.applySettingsUpdate({
                $unset: ['inline-metadata-position'],
              });
            });
        });
      });

    new Setting(contentEl)
      .setName(t('Move task data to card footer'))
      .setDesc(
        t(
          "When toggled, task data (from the Tasks plugin) will be displayed in the card's footer instead of the card's body."
        )
      )
      .then((setting) => {
        let toggleComponent: ToggleComponent;

        setting
          .addToggle((toggle) => {
            toggleComponent = toggle;

            const [value, globalValue] = this.getSetting('move-task-metadata', local);

            if (value !== undefined) {
              toggle.setValue(value as boolean);
            } else if (globalValue !== undefined) {
              toggle.setValue(globalValue as boolean);
            }

            toggle.onChange((newValue) => {
              this.applySettingsUpdate({
                'move-task-metadata': {
                  $set: newValue,
                },
              });
            });
          })
          .addExtraButton((b) => {
            b.setIcon('lucide-rotate-ccw')
              .setTooltip(t('Reset to default'))
              .onClick(() => {
                const [, globalValue] = this.getSetting('move-task-metadata', local);
                toggleComponent.setValue((globalValue as boolean) ?? true);

                this.applySettingsUpdate({
                  $unset: ['move-task-metadata'],
                });
              });
          });
      });

    contentEl.createEl('br');
    contentEl.createEl('h4', { text: t('Linked Page Metadata') });
    contentEl.createEl('p', {
      cls: c('metadata-setting-desc'),
      text: t(
        'Display metadata for the first note linked within a card. Specify which metadata keys to display below. An optional label can be provided, and labels can be hidden altogether.'
      ),
    });

    new Setting(contentEl).then((setting) => {
      setting.settingEl.addClass(c('draggable-setting-container'));

      const [value] = this.getSetting('metadata-keys', local);

      const keys: MetadataSetting[] = ((value as DataKey[]) || ([] as DataKey[])).map((k) => {
        return {
          ...MetadataSettingTemplate,
          id: generateInstanceId(),
          data: k,
          win: getParentWindow(contentEl),
        };
      });

      renderMetadataSettings(setting.settingEl, contentEl, keys, (keys: MetadataSetting[]) =>
        this.applySettingsUpdate({
          'metadata-keys': {
            $set: keys.map((k) => k.data),
          },
        })
      );

      this.cleanupFns.push(() => {
        if (setting.settingEl) {
          cleanupMetadataSettings(setting.settingEl);
        }
      });
    });

    contentEl.createEl('h4', { text: t('Board Header Buttons') });

    new Setting(contentEl).setName(t('Add a list')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-add-list', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-add-list': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-add-list', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-add-list'],
              });
            });
        });
    });

    new Setting(contentEl).setName(t('Archive completed cards')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-archive-all', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-archive-all': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-archive-all', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-archive-all'],
              });
            });
        });
    });

    new Setting(contentEl).setName(t('Open as markdown')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-view-as-markdown', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-view-as-markdown': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-view-as-markdown', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-view-as-markdown'],
              });
            });
        });
    });

    new Setting(contentEl).setName(t('Open board settings')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-board-settings', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-board-settings': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-board-settings', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-board-settings'],
              });
            });
        });
    });

    new Setting(contentEl).setName(t('Search...')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-search', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-search': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-search', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-search'],
              });
            });
        });
    });

    new Setting(contentEl).setName(t('Board view')).then((setting) => {
      let toggleComponent: ToggleComponent;

      setting
        .addToggle((toggle) => {
          toggleComponent = toggle;

          const [value, globalValue] = this.getSetting('show-set-view', local);

          if (value !== undefined && value !== null) {
            toggle.setValue(value as boolean);
          } else if (globalValue !== undefined && globalValue !== null) {
            toggle.setValue(globalValue as boolean);
          } else {
            // default
            toggle.setValue(true);
          }

          toggle.onChange((newValue) => {
            this.applySettingsUpdate({
              'show-set-view': {
                $set: newValue,
              },
            });
          });
        })
        .addExtraButton((b) => {
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(t('Reset to default'))
            .onClick(() => {
              const [, globalValue] = this.getSetting('show-set-view', local);
              toggleComponent.setValue(!!globalValue);

              this.applySettingsUpdate({
                $unset: ['show-set-view'],
              });
            });
        });
    });
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
        await vault.modify(draftAstFile, JSON.stringify(jsonFile, (k, v) => (['position', 'extension'].includes(k) ? undefined : v), 2));
      } else {
        await vault.create(draftAstPath, JSON.stringify(jsonFile, (k, v) => (['position', 'extension'].includes(k) ? undefined : v), 2));
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
      const astJson = JSON.stringify(jsonFile, (k, v) => (['position', 'extension'].includes(k) ? undefined : v), 2);
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
      const { metadataCache } = this.app;
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

    this.settingsManager.constructUI(containerEl, t('Kanban Plugin'), false);
  }
}
