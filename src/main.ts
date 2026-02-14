import { around } from 'monkey-around';
import { MarkdownView, Modal, Notice, Platform, Plugin, TFile, TFolder, ViewState, WorkspaceLeaf, debounce } from 'obsidian';
import { render, unmountComponentAtNode, useEffect, useState } from 'preact/compat';

import { createApp } from './DragDropApp';
import { KanbanView, astIcon, kanbanViewType, publishIcon } from './KanbanView';
import { triggerCloudflareDeployment } from './cloudflare';
import { BaseFolderConfig, KanbanSettings, KanbanSettingsTab } from './Settings';
import { StateManager } from './StateManager';
import { DateSuggest, TimeSuggest } from './components/Editor/suggest';
import { getParentWindow } from './dnd/util/getWindow';
import { hasFrontmatterKey } from './helpers';
import { t } from './lang/helpers';
import { basicFrontmatter, frontmatterKey } from './parsers/common';


interface WindowRegistry {
  viewMap: Map<string, KanbanView>;
  viewStateReceivers: Array<(views: KanbanView[]) => void>;
  appRoot: HTMLElement;
}

class PublishModal extends Modal {
  private folders: BaseFolderConfig[];
  private onSubmit: (selected: BaseFolderConfig[]) => void;

  constructor(app: any, folders: BaseFolderConfig[], onSubmit: (selected: BaseFolderConfig[]) => void) {
    super(app);
    this.folders = folders;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Publish Changes' });

    const checked = new Map<number, boolean>(this.folders.map((_, i) => [i, false]));

    this.folders.forEach((folder, index) => {
      const row = contentEl.createDiv({ cls: 'publish-modal-row' });
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.marginBottom = '6px';
      const checkbox = row.createEl('input', { type: 'checkbox' } as any) as HTMLInputElement;
      checkbox.checked = false;
      checkbox.onchange = () => { checked.set(index, checkbox.checked); };
      row.createEl('span', { text: folder.path });
    });

    const btn = contentEl.createEl('button', { text: 'Push selected' });
    btn.style.marginTop = '1em';
    btn.onclick = () => {
      const selected = this.folders.filter((_, i) => checked.get(i) !== false);
      this.close();
      this.onSubmit(selected);
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class StagingModal extends Modal {
  private file: TFile;
  private onDraft: () => void;
  private onPublish: () => void;

  constructor(app: any, file: TFile, onDraft: () => void, onPublish: () => void) {
    super(app);
    this.file = file;
    this.onDraft = onDraft;
    this.onPublish = onPublish;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Save as…' });
    contentEl.createEl('p', { text: this.file.name });

    const btnRow = contentEl.createDiv();
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '1em';

    const draftBtn = btnRow.createEl('button', { text: 'Draft' });
    draftBtn.onclick = () => { this.close(); this.onDraft(); };

    const publishBtn = btnRow.createEl('button', { text: 'Publish' });
    publishBtn.onclick = () => { this.close(); this.onPublish(); };
  }

  onClose() {
    this.contentEl.empty();
  }
}

function getEditorClass(app: any) {
  const md = app.embedRegistry.embedByExtension.md(
    { app: app, containerEl: createDiv(), state: {} },
    null,
    ''
  );

  md.load();
  md.editable = true;
  md.showEditor();

  const MarkdownEditor = Object.getPrototypeOf(Object.getPrototypeOf(md.editMode)).constructor;

  md.unload();

  return MarkdownEditor;
}

export default class KanbanPlugin extends Plugin {
  settingsTab: KanbanSettingsTab;
  settings: KanbanSettings = {};

  // leafid => view mode
  kanbanFileModes: Record<string, string> = {};
  stateManagers: Map<TFile, StateManager> = new Map();

  windowRegistry: Map<Window, WindowRegistry> = new Map();

  _loaded: boolean = false;

  isShiftPressed: boolean = false;

  async loadSettings() {
    this.settings = Object.assign({}, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  unload(): void {
    super.unload();
    Promise.all(
      this.app.workspace.getLeavesOfType(kanbanViewType).map((leaf) => {
        this.kanbanFileModes[(leaf as any).id] = 'markdown';
        return this.setMarkdownView(leaf);
      })
    );
  }

  onunload() {
    this.MarkdownEditor = null;
    this.windowRegistry.forEach((reg, win) => {
      reg.viewStateReceivers.forEach((fn) => fn([]));
      this.unmount(win);
    });

    this.unmount(window);

    this.stateManagers.clear();
    this.windowRegistry.clear();
    this.kanbanFileModes = {};

    (this.app.workspace as any).unregisterHoverLinkSource(frontmatterKey);
  }

  MarkdownEditor: any;

  async onload() {
    await this.loadSettings();

    // Migrate legacy single base-folder to base-folders array
    if (!this.settings['base-folders'] && this.settings['base-folder']) {
      this.settings['base-folders'] = [{ path: this.settings['base-folder'] }];
      await this.saveSettings();
    }

    this.MarkdownEditor = getEditorClass(this.app);

    this.registerEditorSuggest(new TimeSuggest(this.app, this));
    this.registerEditorSuggest(new DateSuggest(this.app, this));

    this.registerEvent(
      this.app.workspace.on('window-open', (_: any, win: Window) => {
        this.mount(win);
      })
    );

    this.registerEvent(
      this.app.workspace.on('window-close', (_: any, win: Window) => {
        this.unmount(win);
      })
    );

    this.settingsTab = new KanbanSettingsTab(this, {
      onSettingsChange: async (newSettings) => {
        this.settings = newSettings;
        await this.saveSettings();

        // Force a complete re-render when settings change
        this.stateManagers.forEach((stateManager) => {
          stateManager.forceRefresh();
        });
      },
    });

    this.addSettingTab(this.settingsTab);

    this.registerView(kanbanViewType, (leaf) => new KanbanView(leaf, this));
    this.registerCommands();
    this.registerEvents();

    // Mount an empty component to start; views will be added as we go
    this.mount(window);

    (this.app.workspace as any).floatingSplit?.children?.forEach((c: any) => {
      this.mount(c.win);
    });

    this.registerDomEvent(window, 'keydown', this.handleShift);
    this.registerDomEvent(window, 'keyup', this.handleShift);

    this.addRibbonIcon(astIcon, t('Generate AST'), () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') {
        new Notice('Open a markdown file first');
        return;
      }
      if (file.name.endsWith('.draft.md') || file.name.endsWith('.published.md')) {
        new Notice('Cannot generate AST for snapshot files');
        return;
      }
      new StagingModal(
        this.app,
        file,
        () => this.settingsTab.settingsManager.saveAsDraft(file),
        () => this.settingsTab.settingsManager.saveAsPublished(file),
      ).open();
    });

    this.addRibbonIcon(publishIcon, t('Publish changes'), () => {
      this.publishChanges();
    });
  }

  handleShift = (e: KeyboardEvent) => {
    this.isShiftPressed = e.shiftKey;
  };

  getKanbanViews(win: Window) {
    const reg = this.windowRegistry.get(win);

    if (reg) {
      return Array.from(reg.viewMap.values());
    }

    return [];
  }

  getKanbanView(id: string, win: Window) {
    const reg = this.windowRegistry.get(win);

    if (reg?.viewMap.has(id)) {
      return reg.viewMap.get(id);
    }

    for (const reg of this.windowRegistry.values()) {
      if (reg.viewMap.has(id)) {
        return reg.viewMap.get(id);
      }
    }

    return null;
  }

  getStateManager(file: TFile) {
    return this.stateManagers.get(file);
  }

  getStateManagerFromViewID(id: string, win: Window) {
    const view = this.getKanbanView(id, win);

    if (!view) {
      return null;
    }

    return this.stateManagers.get(view.file);
  }

  useKanbanViews(win: Window): KanbanView[] {
    const [state, setState] = useState(this.getKanbanViews(win));

    useEffect(() => {
      const reg = this.windowRegistry.get(win);

      reg?.viewStateReceivers.push(setState);

      return () => {
        reg?.viewStateReceivers.remove(setState);
      };
    }, [win]);

    return state;
  }

  // todo(turnip): remove addView
  addView(view: KanbanView, data: string, shouldParseData: boolean) {
    const win = view.getWindow();
    const reg = this.windowRegistry.get(win);

    if (!reg) return;
    if (!reg.viewMap.has(view.id)) {
      reg.viewMap.set(view.id, view);
    }

    const file = view.file;

    reg.viewStateReceivers.forEach((fn) => fn(this.getKanbanViews(win)));
  }

  removeView(view: KanbanView) {
    const entry = Array.from(this.windowRegistry.entries()).find(([, reg]) => {
      return reg.viewMap.has(view.id);
    }, []);

    if (!entry) return;

    const [win, reg] = entry;
    const file = view.file;

    if (reg.viewMap.has(view.id)) {
      reg.viewMap.delete(view.id);
    }

    if (this.stateManagers.has(file)) {
      this.stateManagers.get(file).unregisterView(view);
      reg.viewStateReceivers.forEach((fn) => fn(this.getKanbanViews(win)));
    }
  }

  handleViewFileRename(view: KanbanView, oldPath: string) {
    const win = view.getWindow();
    if (!this.windowRegistry.has(win)) {
      return;
    }

    const reg = this.windowRegistry.get(win);
    const oldId = `${(view.leaf as any).id}:::${oldPath}`;

    if (reg.viewMap.has(oldId)) {
      reg.viewMap.delete(oldId);
    }

    if (!reg.viewMap.has(view.id)) {
      reg.viewMap.set(view.id, view);
    }

    if (view.isPrimary) {
      this.getStateManager(view.file).softRefresh();
    }
  }

  mount(win: Window) {
    if (this.windowRegistry.has(win)) {
      return;
    }

    const el = win.document.body.createDiv();

    this.windowRegistry.set(win, {
      viewMap: new Map(),
      viewStateReceivers: [],
      appRoot: el,
    });

    render(createApp(win, this), el);
  }

  unmount(win: Window) {
    if (!this.windowRegistry.has(win)) {
      return;
    }

    const reg = this.windowRegistry.get(win);

    for (const view of reg.viewMap.values()) {
      this.removeView(view);
    }

    unmountComponentAtNode(reg.appRoot);

    reg.appRoot.remove();
    reg.viewMap.clear();
    reg.viewStateReceivers.length = 0;
    reg.appRoot = null;

    this.windowRegistry.delete(win);
  }

  async setMarkdownView(leaf: WorkspaceLeaf, focus: boolean = true) {
    await leaf.setViewState(
      {
        type: 'markdown',
        state: leaf.view.getState(),
        popstate: true,
      } as ViewState,
      { focus }
    );
  }

  async setKanbanView(leaf: WorkspaceLeaf) {
    await leaf.setViewState({
      type: kanbanViewType,
      state: leaf.view.getState(),
      popstate: true,
    } as ViewState);
  }

  async newKanban(folder?: TFolder) {
    this.settingsTab.settingsManager.generateAst();
  }

  async publishChanges(_folder?: TFolder) {
    const baseFolders = this.settings['base-folders'] ?? [];

    if (baseFolders.length === 0) {
      new Notice('Error: No base folders configured.');
      return;
    }

    new PublishModal(this.app, baseFolders, async (selected) => {
      const adapter = this.app.vault.adapter as any;
      const { exec } = (window as any).require('child_process');

      const run = (cmd: string, cwd: string): Promise<string> =>
        new Promise((resolve, reject) => {
          exec(cmd, { cwd }, (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
          });
        });

      for (const folder of selected) {
        const repoPath = `${adapter.basePath}/${folder.path}`;
        const notice = new Notice(`Pushing ${folder.path}…`, 0);

        try {
          await run('git add -A', repoPath);

          const statusOut = await run('git status --porcelain', repoPath);
          if (statusOut.trim()) {
            const timestamp = new Date().toISOString();
            await run(`git commit -m "content: auto-publish ${timestamp}"`, repoPath);
          }

          let hasOrigin = true;
          try {
            await run('git remote get-url origin', repoPath);
          } catch {
            hasOrigin = false;
          }

          if (hasOrigin) {
            await run('git push origin main', repoPath);
            if (folder.cloudflare?.accountId && folder.cloudflare.triggerId && folder.cloudflare.apiToken && folder.cloudflare.webRepoPath) {
              const os = (window as any).require('os');
              const webRepoPath = folder.cloudflare.webRepoPath.replace(/^~/, os.homedir());
              await run('git fetch origin main:main --recurse-submodules=no --progress --prune', webRepoPath);
              const commitHash = (await run('git rev-parse main', webRepoPath)).trim();
              notice.setMessage(`${folder.path}: deploying to Cloudflare…`);
              try {
                await triggerCloudflareDeployment(folder.cloudflare, commitHash, notice);
                notice.hide();
                new Notice(`${folder.path}: pushed + deployed to Cloudflare.`);
              } catch (cfErr) {
                notice.hide();
                const msg = cfErr instanceof Error ? cfErr.message : String(cfErr);
                console.error(msg);
                new Notice(`${folder.path}: pushed, but Cloudflare deploy failed: ${msg}`);
              }
            } else {
              notice.hide();
              new Notice(`${folder.path}: pushed successfully.`);
            }
          } else {
            notice.hide();
            new Notice(`${folder.path}: committed (no remote origin set).`);
          }
        } catch (err) {
          notice.hide();
          const message = err instanceof Error ? err.message : String(err);
          new Notice(`Git push failed for ${folder.path}: ${message}`);
          console.error('[publishChanges]', err);
        }
      }
    }).open();
  }

  registerEvents() {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (source === 'link-context-menu') return;

        const fileIsFile = file instanceof TFile;
        const fileIsFolder = file instanceof TFolder;
        const leafIsMarkdown = leaf?.view instanceof MarkdownView;
        const leafIsKanban = leaf?.view instanceof KanbanView;

        // Add a menu item to the folder context menu to create a board
        if (fileIsFolder) {
          menu.addItem((item) => {
            item
              .setSection('action-primary')
              .setTitle(t('Generate AST'))
              .setIcon(astIcon)
              .onClick(() => this.newKanban(file));
          });
          return;
        }

        if (
          !Platform.isMobile &&
          fileIsFile &&
          leaf &&
          source === 'sidebar-context-menu' &&
          hasFrontmatterKey(file)
        ) {
          const views = this.getKanbanViews(getParentWindow(leaf.view.containerEl));
          let haveKanbanView = false;

          for (const view of views) {
            if (view.file === file) {
              view.onPaneMenu(menu, 'more-options', false);
              haveKanbanView = true;
              break;
            }
          }

          if (!haveKanbanView) {
            menu.addItem((item) => {
              item
                .setTitle(t('Open as kanban board'))
                .setIcon(astIcon)
                .setSection('pane')
                .onClick(() => {
                  this.kanbanFileModes[(leaf as any).id || file.path] = kanbanViewType;
                  this.setKanbanView(leaf);
                });
            });

            return;
          }
        }
      })
    );

    this.registerEvent(
      (app as any).metadataCache.on('dataview:api-ready', () => {
        this.stateManagers.forEach((manager) => {
          manager.forceRefresh();
        });
      })
    );
  }

  registerCommands() {
    this.addCommand({
      id: 'generate-ast',
      name: t('Generate AST'),
      callback: () => this.newKanban(),
    });

    this.addCommand({
      id: 'save-as-draft',
      name: 'Save active file as draft',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.extension.match(/^md$/)) return false;
        if (checking) return true;
        this.settingsTab.settingsManager.saveAsDraft(file);
      },
    });

    this.addCommand({
      id: 'save-as-published',
      name: 'Save active file as published',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.extension.match(/^md$/)) return false;
        if (checking) return true;
        this.settingsTab.settingsManager.saveAsPublished(file);
      },
    });
  }
}
