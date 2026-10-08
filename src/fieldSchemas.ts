// Field schemas for the Publication tab's type-based Metadata Editor.
// Transcribed from the Dataset/Workflow/Component field lists in the
// Publication redesign spec. These mirror the metadata profile analysis
// from the thesis (RM-ODP viewpoints for components, ISO19115-style
// fields for datasets) so the same field set used in the coverage
// analysis is what's actually editable here.

export type FieldKind = 'text' | 'textarea' | 'date' | 'tags';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  // Required only when the field named here has a value. Used for the
  // Workflow Run fields: a workflow can be published without a run, but
  // once a run identifier is given the core run fields must be complete.
  requiredWhen?: string;
}

export interface FieldGroup {
  group: string;
  fields: FieldDef[];
}

export const DATASET_SCHEMA: FieldGroup[] = [
  {
    group: 'Metadata Contact',
    fields: [
      { key: 'metadataContactOrganisation', label: 'Metadata contact: Organisation', kind: 'text' },
      { key: 'metadataContactEmail', label: 'Metadata contact: Email', kind: 'text' },
      { key: 'metadataContactRole', label: 'Metadata contact: Role', kind: 'text' },
      { key: 'metadataDate', label: 'Metadata date', kind: 'date' },
      { key: 'metadataLanguage', label: 'Metadata language', kind: 'text' }
    ]
  },
  {
    group: 'Resource Description',
    fields: [
      { key: 'resourceTitle', label: 'Resource title', kind: 'text', required: true },
      { key: 'resourceLocator', label: 'Resource locator', kind: 'text' },
      { key: 'resourceAbstract', label: 'Resource abstract', kind: 'textarea', required: true },
      { key: 'resourceType', label: 'Resource type', kind: 'text' },
      { key: 'resourceUniqueIdentifier', label: 'Resource unique identifier', kind: 'text' },
      { key: 'topicCategory', label: 'Topic category', kind: 'text' },
      { key: 'keywordValue', label: 'Keyword value', kind: 'text' },
      { key: 'freeKeywords', label: 'Free keywords', kind: 'tags' },
      { key: 'vocabularyTitle', label: 'Vocabulary: Title', kind: 'text' },
      { key: 'vocabularyReferenceDate', label: 'Vocabulary: Reference date', kind: 'date' },
      { key: 'vocabularyDateType', label: 'Vocabulary: Date type', kind: 'text' }
    ]
  },
  {
    group: 'Spatial & Temporal Coverage',
    fields: [
      { key: 'geographicBoundingBox', label: 'Geographic Bounding Box', kind: 'text' },
      { key: 'temporalExtentBegin', label: 'Temporal extent — begin date', kind: 'date' },
      { key: 'temporalExtentEnd', label: 'Temporal extent — end date', kind: 'date' },
      { key: 'temporalExtentSingleDate', label: 'Temporal extent — single date', kind: 'date' }
    ]
  },
  {
    group: 'Quality & Distribution',
    fields: [
      { key: 'lineage', label: 'Lineage', kind: 'textarea' },
      { key: 'dataFormat', label: 'Data format', kind: 'text' },
      { key: 'spatialRepresentationType', label: 'Spatial representation type', kind: 'text' },
      { key: 'conditionsForAccessAndUse', label: 'Conditions for access and use', kind: 'text', required: true },
      { key: 'limitationsOnPublicUse', label: 'Limitations on public use', kind: 'text' }
    ]
  },
  {
    group: 'Responsible Party',
    fields: [
      { key: 'responsiblePartyOrganisation', label: 'Responsible party: Organisation', kind: 'text' },
      { key: 'responsiblePartyEmail', label: 'Responsible party: Email', kind: 'text' },
      { key: 'responsiblePartyRole', label: 'Responsible party: Role', kind: 'text' },
      { key: 'relatedPublications', label: 'Related publications', kind: 'tags' }
    ]
  }
];

// Two parts in one form: 'Workflow' describes the definition (identity,
// rights, structure, environment, metadata quality) and 'Workflow Run'
// describes one execution of it. The original nine keys (workflowName,
// description, workflowFile, components, inputDatasets, outputDatasets,
// repositoryUrl, commitHash, naavreVersion) are kept unchanged.
export const WORKFLOW_SCHEMA: FieldGroup[] = [
  {
    group: 'Workflow',
    fields: [
      // Identity and description
      { key: 'persistentIdentifier', label: 'Persistent identifier', kind: 'text' },
      { key: 'workflowName', label: 'Workflow name', kind: 'text', required: true },
      { key: 'description', label: 'Description', kind: 'textarea', required: true },
      { key: 'workflowType', label: 'Type and profile declaration', kind: 'text', required: true },
      { key: 'keywords', label: 'Keywords', kind: 'tags' },
      { key: 'purpose', label: 'Purpose / research question', kind: 'textarea' },
      { key: 'virtualLab', label: 'Virtual lab', kind: 'text' },
      { key: 'scientificDomain', label: 'Scientific domain', kind: 'text' },
      { key: 'spatialCoverage', label: 'Spatial coverage', kind: 'text' },
      { key: 'temporalCoverage', label: 'Temporal coverage', kind: 'text' },

      // Rights and attribution
      { key: 'license', label: 'License', kind: 'text', required: true },
      { key: 'creators', label: 'Creators (name, ORCID, affiliation)', kind: 'tags', required: true },
      { key: 'version', label: 'Version', kind: 'text', required: true },
      { key: 'repositoryUrl', label: 'Repository URL', kind: 'text', required: true },
      { key: 'commitHash', label: 'Commit hash', kind: 'text', required: true },
      { key: 'datePublished', label: 'Date published', kind: 'date' },
      { key: 'dateCreated', label: 'Date created', kind: 'date' },
      { key: 'dateModified', label: 'Date modified', kind: 'date' },
      { key: 'accessRights', label: 'Access rights', kind: 'text' },
      { key: 'branch', label: 'Branch', kind: 'text' },
      { key: 'publisher', label: 'Publisher', kind: 'text' },
      { key: 'citation', label: 'Citation / publications', kind: 'tags' },

      // Definition
      { key: 'workflowFile', label: 'Workflow file', kind: 'text', required: true },
      { key: 'workflowLanguage', label: 'Workflow language', kind: 'text', required: true },
      { key: 'components', label: 'Components', kind: 'tags', required: true },
      { key: 'parameters', label: 'Parameters (name, type, default)', kind: 'textarea', required: true },
      { key: 'connections', label: 'Connections between ports', kind: 'textarea' },
      { key: 'declaredInputs', label: 'Declared inputs', kind: 'tags' },
      { key: 'outputDatasets', label: 'Declared outputs', kind: 'tags' },
      { key: 'inputDatasets', label: 'Input datasets (reference)', kind: 'tags' },
      { key: 'inputDatasetIdentifiers', label: 'Input dataset identifier and version', kind: 'tags' },
      { key: 'stepOrder', label: 'Step order', kind: 'tags' },
      { key: 'parameterDescriptions', label: 'Parameter meaning, units, ranges', kind: 'textarea' },
      { key: 'requiredSecrets', label: 'Required secrets and configuration (names)', kind: 'tags' },
      { key: 'diagram', label: 'Diagram', kind: 'text' },

      // Environment
      { key: 'containerImages', label: 'Container images', kind: 'tags', required: true },
      { key: 'imageDigests', label: 'Image digests', kind: 'tags' },
      { key: 'baseImages', label: 'Base build and runtime image', kind: 'tags' },
      { key: 'languages', label: 'Languages', kind: 'tags' },
      { key: 'dependencies', label: 'Dependencies with versions, or environment file', kind: 'tags' },
      { key: 'workflowEngine', label: 'Workflow engine and version', kind: 'text' },
      { key: 'resourceManager', label: 'Resource manager / cluster', kind: 'text' },
      { key: 'naavreVersion', label: 'NaaVRE version', kind: 'text' },
      { key: 'hardwareRequirements', label: 'Hardware requirements', kind: 'text' },
      { key: 'executionInstructions', label: 'Execution instructions', kind: 'textarea' },

      // Quality and metadata provenance
      { key: 'fieldSources', label: 'Source per field', kind: 'textarea' },
      { key: 'completeness', label: 'Completeness per objective', kind: 'text' },
      { key: 'metadataDate', label: 'Metadata date', kind: 'date' },
      { key: 'metadataContact', label: 'Metadata contact', kind: 'text' },
      { key: 'fieldConfidence', label: 'Confidence and validation status per field', kind: 'textarea' },
      { key: 'tests', label: 'Tests and expected outputs', kind: 'tags' },
      { key: 'knownLimitations', label: 'Known limitations', kind: 'textarea' }
    ]
  },
  {
    group: 'Workflow Run',
    fields: [
      { key: 'runIdentifier', label: 'Run identifier', kind: 'text' },
      { key: 'runWorkflowReference', label: 'Workflow reference (PID and commit)', kind: 'text', requiredWhen: 'runIdentifier' },
      { key: 'runStatus', label: 'Status', kind: 'text', requiredWhen: 'runIdentifier' },
      { key: 'runStartedAt', label: 'Started', kind: 'text', requiredWhen: 'runIdentifier' },
      { key: 'runFinishedAt', label: 'Finished', kind: 'text', requiredWhen: 'runIdentifier' },
      { key: 'runParameterValues', label: 'Actual parameter values', kind: 'textarea', requiredWhen: 'runIdentifier' },
      { key: 'runInputs', label: 'Actual inputs', kind: 'tags', requiredWhen: 'runIdentifier' },
      { key: 'runOutputs', label: 'Actual outputs (reference)', kind: 'tags', requiredWhen: 'runIdentifier' },
      {
        key: 'runExecutedSteps',
        label: 'Executed steps (component PID, image, status, exit code, times)',
        kind: 'textarea',
        requiredWhen: 'runIdentifier'
      },
      { key: 'runStepDependencies', label: 'Step dependencies', kind: 'textarea' },
      { key: 'runOutputChecksums', label: 'Output checksum and size', kind: 'textarea' },
      { key: 'runSubmittedBy', label: 'Submitted by', kind: 'text' },
      { key: 'runDuration', label: 'Duration', kind: 'text' },
      { key: 'runLocation', label: 'Location (cluster, virtual lab)', kind: 'text' },
      { key: 'runResourceUsage', label: 'Resource usage', kind: 'textarea' },
      { key: 'runErrorMessage', label: 'Error message', kind: 'textarea' },
      { key: 'runLogsReference', label: 'Logs reference', kind: 'text' },
      { key: 'runObservations', label: 'Observations', kind: 'textarea' },
      { key: 'runReproduced', label: 'Reproduced by re-run', kind: 'text' }
    ]
  }
];

export const COMPONENT_SCHEMA: FieldGroup[] = [
  {
    group: 'Domain Viewpoint',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'description', label: 'Description', kind: 'textarea', required: true },
      { key: 'keywords', label: 'Keywords', kind: 'tags' },
      { key: 'abstractPurpose', label: 'Abstract / Purpose', kind: 'textarea' },
      { key: 'modelVersion', label: 'Model Version', kind: 'text' },
      { key: 'authorsUniqueIdentifier', label: 'Authors Unique Identifier', kind: 'text' },
      { key: 'contributorRole', label: 'Contributor Role', kind: 'text' },
      { key: 'modelTypeParadigm', label: 'Model Type / Paradigm', kind: 'text' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'purposeAndPattern', label: 'Purpose & Pattern', kind: 'text' },
      { key: 'assumptions', label: 'Assumptions', kind: 'textarea' },
      { key: 'linksToPublications', label: 'Links to Publications', kind: 'tags' },
      { key: 'conceptualModelEval', label: 'Conceptual Model Eval.', kind: 'text' },
      { key: 'calibrationToolsData', label: 'Calibration Tools/Data', kind: 'text' },
      { key: 'validationCapabilities', label: 'Validation Capabilities', kind: 'text' },
      { key: 'sensitivityAnalysis', label: 'Sensitivity Analysis', kind: 'text' },
      { key: 'uncertaintyAnalysis', label: 'Uncertainty Analysis', kind: 'text' }
    ]
  },
  {
    group: 'Information Viewpoint',
    fields: [
      { key: 'modelUniqueId', label: 'Model Unique ID', kind: 'text' },
      { key: 'submodelUniqueIds', label: 'Submodel Unique IDs', kind: 'tags' },
      { key: 'parameterNames', label: 'Parameters (names)', kind: 'tags' },
      { key: 'parameterDefaults', label: 'Parameters (defaults)', kind: 'text' },
      { key: 'parametersActualRun', label: 'Parameters (actual run)', kind: 'text' },
      { key: 'parametersUnitsRanges', label: 'Parameters (units/ranges)', kind: 'text' },
      { key: 'infoInputDatasets', label: 'Input Datasets', kind: 'tags' },
      { key: 'output', label: 'Output', kind: 'tags' },
      { key: 'spatialCoverage', label: 'Spatial Coverage', kind: 'text' },
      { key: 'temporalCoverage', label: 'Temporal Coverage', kind: 'text' },
      { key: 'dimensionality', label: 'Dimensionality', kind: 'text' },
      { key: 'spatialResolution', label: 'Spatial Resolution', kind: 'text' },
      { key: 'variableSpatialRes', label: 'Variable Spatial Res.', kind: 'text' },
      { key: 'timeStepsTemporalRes', label: 'Time Steps / Temporal Res.', kind: 'text' },
      { key: 'variableTemporalRes', label: 'Variable Temporal Res.', kind: 'text' },
      { key: 'resamplingPolicies', label: 'Resampling Policies', kind: 'text' }
    ]
  },
  {
    group: 'Computational Viewpoint',
    fields: [
      { key: 'interfaceSignature', label: 'Interface Signature', kind: 'textarea' },
      { key: 'errorHandling', label: 'Error Handling', kind: 'text' },
      { key: 'integrationPattern', label: 'Integration Pattern', kind: 'text' }
    ]
  },
  {
    group: 'Engineering Viewpoint',
    fields: [
      { key: 'supportForParallelExec', label: 'Support for Parallel Exec.', kind: 'text' },
      { key: 'executionConstraints', label: 'Execution Constraints', kind: 'text' },
      { key: 'acknowledgmentProtocols', label: 'Acknowledgment Protocols', kind: 'text' },
      { key: 'latencyExpectations', label: 'Latency Expectations', kind: 'text' },
      { key: 'dataSynchronization', label: 'Data Synchronization', kind: 'text' }
    ]
  },
  {
    group: 'Technology Viewpoint',
    fields: [
      { key: 'programmingLanguage', label: 'Programming Language', kind: 'text' },
      { key: 'availabilityOfSourceCode', label: 'Availability of Source Code', kind: 'text' },
      { key: 'implementationVerification', label: 'Implementation Verification', kind: 'text' },
      { key: 'softwareRequirements', label: 'Software Requirements', kind: 'textarea' },
      { key: 'hardwareSpecification', label: 'Hardware Specification', kind: 'text' },
      { key: 'executionInstructions', label: 'Execution Instructions', kind: 'textarea' },
      { key: 'license', label: 'License', kind: 'text', required: true },
      { key: 'landingPage', label: 'Landing Page', kind: 'text' },
      { key: 'distributionVersion', label: 'Distribution Version', kind: 'text' },
      { key: 'runtimePlatform', label: 'Runtime Platform', kind: 'text' },
      { key: 'dateCreatedModified', label: 'Date Created/Modified', kind: 'date' },
      { key: 'dataflowConnections', label: 'Dataflow Connections', kind: 'tags' },
      { key: 'componentDescription', label: 'Component Description', kind: 'textarea' },
      { key: 'inputDatasetUrls', label: 'Input Dataset URLs', kind: 'tags' }
    ]
  }
];

export function schemaFor(type: 'dataset' | 'workflow' | 'component'): FieldGroup[] {
  if (type === 'workflow') return WORKFLOW_SCHEMA;
  if (type === 'component') return COMPONENT_SCHEMA;
  return DATASET_SCHEMA;
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === '';
}

export function isFieldRequired(field: FieldDef, metadata: Record<string, unknown> = {}): boolean {
  if (field.required) return true;
  return !!field.requiredWhen && !isEmpty(metadata[field.requiredWhen]);
}

export function requiredFieldKeys(
  type: 'dataset' | 'workflow' | 'component',
  metadata: Record<string, unknown> = {}
): string[] {
  return schemaFor(type).reduce<string[]>((keys, group) => {
    group.fields.forEach(f => {
      if (isFieldRequired(f, metadata)) keys.push(f.key);
    });
    return keys;
  }, []);
}

export function computeMissingFields(
  type: 'dataset' | 'workflow' | 'component',
  metadata: Record<string, unknown>
): string[] {
  return requiredFieldKeys(type, metadata).filter(key => isEmpty(metadata[key]));
}
