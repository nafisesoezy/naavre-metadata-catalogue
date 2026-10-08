import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, ReactWidget } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import React from 'react';

import { FdoStudio } from './components/FdoStudio';
import '../style/fdo-studio.css';

function createFdoStudioWidget(catalogueBaseUrl: string): ReactWidget {
  const widget = ReactWidget.create(<FdoStudio catalogueBaseUrl={catalogueBaseUrl} />);
  widget.id = 'LTER-LIFE-catalogue-panel';
  widget.title.label = 'FDO Studio';
  widget.title.closable = true;
  return widget;
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'naavre-metadata-catalogue-jupyterlab:plugin',
  description: 'LTER-LIFE metadata catalogue and FDO Studio panel for JupyterLab.',
  autoStart: true,
  optional: [ISettingRegistry],
  requires: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension LTER-LIFE-metadata-catalogue is activated.');

    const { commands, shell } = app;
    const command = 'catalogue:open';

    commands.addCommand(command, {
      label: 'Open NaaVRE FDO Studio',
      execute: async () => {
        let catalogueBaseUrl = '';

        if (settingRegistry) {
          try {
            const settings = await settingRegistry.load(plugin.id);
            catalogueBaseUrl =
              (settings.get('metadataCatalogueUrl').composite as string) || '';
          } catch (reason) {
            console.error('Failed to load metadataCatalogueUrl setting.', reason);
          }
        }

        const widget = createFdoStudioWidget(catalogueBaseUrl);
        shell.add(widget, 'main');
        shell.activateById(widget.id);
      }
    });

    palette.addItem({
      command,
      category: 'NaaVRE'
    });
  }
};

export default plugin;
