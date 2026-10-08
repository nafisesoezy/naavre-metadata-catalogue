// Stand-in data for the phases not yet wired to a real backend
// (Composition/Execution/Publication). Discovery is already live against
// catalogue_backend/app.py — see DiscoveryPage.tsx.

import { WorkflowGraph } from './types';

export const mockWorkflowGraph: WorkflowGraph = {
  id: 'veluwe-forest-model-workflow',
  name: 'Veluwe Forest Model Workflow',
  components: [
    {
      id: 'input-dataset',
      label: 'Input Dataset: VELuwe Forest Inventory Data',
      type: 'Dataset',
      status: 'done',
      description: 'Forest inventory records used as the model input.',
      sourceUrl: 'https://github.com/example/veluwe-forest-workflow'
    },
    {
      id: 'data-prep',
      label: '1. Data Preparation',
      type: 'Component',
      status: 'done',
      description: 'Cleans and reformats raw inventory records for the model.',
      inputs: ['Raw Inventory Data'],
      outputs: ['Prepared Data'],
      container: 'data-prep:latest',
      sourceUrl: 'https://github.com/example/veluwe-forest-workflow/tree/main/components/data-prep'
    },
    {
      id: 'flm',
      label: '2. Forest Growth Model (FLM)',
      type: 'Component',
      status: 'done',
      description: 'Simulates forest growth using process-based equations.',
      inputs: ['Prepared Data', 'Model Parameters'],
      outputs: ['Growth Metrics', 'Biomass'],
      container: 'flm:latest',
      sourceUrl: 'https://github.com/example/veluwe-forest-workflow/tree/main/components/flm'
    },
    {
      id: 'output-1',
      label: 'Output 1: Growth Metrics',
      type: 'Output',
      status: 'done'
    },
    {
      id: 'carbon-calc',
      label: '3. Carbon Calculation',
      type: 'Component',
      status: 'done',
      description: 'Derives carbon stocks from growth and biomass estimates.',
      inputs: ['Growth Metrics', 'Biomass'],
      outputs: ['Carbon Stocks'],
      container: 'carbon-calc:latest',
      sourceUrl: 'https://github.com/example/veluwe-forest-workflow/tree/main/components/carbon-calc'
    },
    {
      id: 'output-2',
      label: 'Output 2: Carbon Stocks',
      type: 'Output',
      status: 'done'
    },
    {
      id: 'scenario',
      label: '4. Scenario Analysis',
      type: 'Component',
      status: 'pending',
      description: 'Projects future scenarios under different management options.',
      inputs: ['Carbon Stocks'],
      outputs: ['Scenario Results', 'Maps'],
      container: 'scenario-analysis:latest',
      sourceUrl: 'https://github.com/example/veluwe-forest-workflow/tree/main/components/scenario-analysis'
    },
    {
      id: 'output-3',
      label: 'Output 3: Scenario Results',
      type: 'Output',
      status: 'pending'
    },
    {
      id: 'output-4',
      label: 'Output 4: Maps',
      type: 'Output',
      status: 'pending'
    }
  ],
  edges: [
    { from: 'input-dataset', to: 'data-prep' },
    { from: 'data-prep', to: 'flm' },
    { from: 'flm', to: 'output-1' },
    { from: 'flm', to: 'carbon-calc' },
    { from: 'carbon-calc', to: 'output-2' },
    { from: 'carbon-calc', to: 'scenario' },
    { from: 'scenario', to: 'output-3' },
    { from: 'scenario', to: 'output-4' }
  ]
};
