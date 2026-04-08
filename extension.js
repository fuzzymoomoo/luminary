// @ts-check
'use strict';

const vscode = require('vscode');

const { MediaScanner }          = require('./lib/media-scanner');
const TagStore                  = require('./lib/tag-store');
const PeopleStore               = require('./lib/people-store');
const DuplicateDetector         = require('./lib/duplicate-detector');
const ExportEngine              = require('./lib/export-engine');
const TimelineTreeProvider      = require('./providers/timeline-tree-provider');
const MonthGridProvider         = require('./providers/month-grid-provider');
const DuplicatesPanelProvider   = require('./providers/duplicates-panel-provider');
const TagsPanelProvider         = require('./providers/tags-panel-provider');
const ExportPanelProvider       = require('./providers/export-panel-provider');
const FaceIdProvider            = require('./providers/face-id-provider');
const FacebookImportProvider    = require('./providers/facebook-import-provider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // ── Core services ────────────────────────────────────────────────────────────

  const getRootFolder = () =>
    String(vscode.workspace.getConfiguration('luminary').get('rootFolder') || '').trim();

  const scanner      = new MediaScanner(getRootFolder, context);
  const tagStore     = new TagStore(getRootFolder);
  const peopleStore  = new PeopleStore(getRootFolder);
  const detector     = new DuplicateDetector(scanner);
  const engine       = new ExportEngine();

  context.subscriptions.push(scanner, tagStore, peopleStore, detector);

  // ── UI providers ─────────────────────────────────────────────────────────────

  const timelineTree    = new TimelineTreeProvider(scanner, tagStore);
  const monthGrid       = new MonthGridProvider(context, scanner, tagStore);
  const duplicatesPanel = new DuplicatesPanelProvider(context, scanner, detector);
  const tagsPanel       = new TagsPanelProvider(context, tagStore, scanner);
  const exportPanel     = new ExportPanelProvider(context, scanner, engine);
  const faceIdPanel     = new FaceIdProvider(context, scanner, tagStore, peopleStore);
  const fbImportPanel   = new FacebookImportProvider(context);

  // ── Tree registrations ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.createTreeView('luminaryTimeline', {
      treeDataProvider: timelineTree,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView('luminaryDuplicates', {
      treeDataProvider: detector,
      showCollapseAll: false,
    }),
  );

  // ── Commands ─────────────────────────────────────────────────────────────────

  context.subscriptions.push(

    vscode.commands.registerCommand('luminary.setRootFolder', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles:   false,
        openLabel:        'Set as Media Root',
      });
      if (!uris?.[0]) return;
      await vscode.workspace.getConfiguration('luminary').update(
        'rootFolder', uris[0].fsPath, vscode.ConfigurationTarget.Global
      );
      scanner.invalidateCache();
      timelineTree.refresh();
      vscode.window.showInformationMessage(`Luminary root: ${uris[0].fsPath}`);
    }),

    vscode.commands.registerCommand('luminary.refresh', async () => {
      scanner.invalidateCache();
      timelineTree.refresh();
    }),

    vscode.commands.registerCommand('luminary.openMonth', (year, month) => {
      monthGrid.open(year, month);
    }),

    vscode.commands.registerCommand('luminary.scanDuplicates', () => {
      duplicatesPanel.open();
    }),

    vscode.commands.registerCommand('luminary.openTags', () => {
      tagsPanel.open();
    }),

    vscode.commands.registerCommand('luminary.openExport', (initialSelection) => {
      exportPanel.open(Array.isArray(initialSelection) ? initialSelection : undefined);
    }),

    vscode.commands.registerCommand('luminary.openFaceId', () => {
      faceIdPanel.open();
    }),

    vscode.commands.registerCommand('luminary.openFacebookImport', () => {
      fbImportPanel.open();
    }),

    // React to settings changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('luminary.rootFolder')) {
        scanner.invalidateCache();
        timelineTree.refresh();
      }
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
