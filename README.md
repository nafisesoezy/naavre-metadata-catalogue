# FAIR Digital Objects for NaaVRE Virtual Labs

## Overview

This project develops a FAIR Digital Object (FDO) framework for managing and publishing research assets within NaaVRE Virtual Labs.

The framework uses RO-Crate to represent scientific workflows, datasets, and reusable workflow components as FAIR Digital Objects, supporting the FAIR principles, reproducibility, traceability, and provenance.

As part of this work, FDO Studio has been developed and integrated into the NaaVRE Virtual Lab environment. It provides a unified interface for discovering research assets, collecting and enriching their metadata, and preparing them for publication as reusable FAIR Digital Objects.

## Objectives

The project aims to:

- Define FAIR Digital Objects for scientific workflows, datasets, and reusable workflow components.
- Design RO-Crate packaging that links research assets through structured metadata and persistent identifiers.
- Adapt existing RO-Crate profiles to define metadata profiles for these objects, supporting FAIR principles, reproducibility, traceability, and provenance.
- Extract and enrich metadata from different research environments, including catalogues, GitHub repositories, and NaaVRE.
- Enable the publication and discovery of connected research assets across Virtual Labs.

## Implemented Work

### 1. FAIR Digital Object Definitions and Metadata Profiles

Three main FDO types have been defined:

- **Workflow FDO:** Represents a scientific workflow, including its structure, components, inputs, outputs, and execution requirements.
- **Dataset FDO:** Represents a dataset, including its description, identifiers, versions, access information, and provenance.
- **Component FDO:** Represents a reusable computational component, including its functionality, parameters, input/output ports, and software dependencies.

Existing RO-Crate profiles have been reviewed and adapted to define structured metadata profiles for these objects.

The metadata profiles are designed to support FAIR principles and provide the information needed for research asset discovery, reuse, reproducibility, and provenance tracking.

For workflows, the metadata model distinguishes between:

- **Workflow Profile:** Describes a workflow independently of a particular execution.
- **Workflow Run Profile:** Describes a specific execution, including actual inputs, parameters, execution status, outputs, and provenance.

### 2. RO-Crate Packaging Design

An RO-Crate-based packaging approach has been designed to represent workflows, datasets, and components as reusable research objects.

The approach defines how structured metadata, identifiers, and references to related assets can be included in RO-Crate packages.

It provides the foundation for linking research assets and representing their relationships in a machine-readable format.

### 3. FDO Studio Integration with NaaVRE

FDO Studio has been integrated into the NaaVRE Virtual Lab environment to support research asset discovery and metadata management.

The studio provides three entry points for capturing research assets:

1. **Catalogue / Repository:** Discover and select datasets and other research assets from metadata catalogues and repositories.
2. **GitHub Repository:** Retrieve workflow definitions, source code, and related metadata from GitHub repositories.
3. **NaaVRE:** Access workflows and reusable components available within the NaaVRE environment.

These entry points bring research assets from different environments into a common metadata management workflow.

### 4. Metadata Harvesting and Enrichment

A metadata harvesting approach has been developed to collect available metadata from each source environment according to the defined FDO metadata profiles.

Metadata is extracted as far as possible from existing sources, including:

- Catalogue records and repository metadata
- GitHub repository information and workflow definition files
- NaaVRE workflow and component specifications

The approach identifies metadata that can be automatically harvested and fields that are missing or incomplete.

Metadata enrichment is considered for filling these gaps, with the aim of improving metadata completeness and consistency while preserving traceability to the original sources.

## Planned Work

### 1. Persistent Identifier Management

Develop an internal persistent identifier management system for FDO Studio.

The system will support the assignment and management of identifiers for workflows, datasets, and components, allowing assets to be consistently referenced and linked across Virtual Labs.

### 2. Workflow Run Metadata Capture

Extend metadata harvesting to capture Workflow Run Profile metadata directly from NaaVRE execution records.

This includes:

- Workflow execution identifiers and status
- Execution start and end times
- Actual input datasets and parameter values
- Executed components and their versions
- Generated outputs
- Execution provenance

This will connect workflow definitions with their actual executions and support reproducibility and traceability.

### 3. Research Asset Relationship Management

Capture relationships between research assets as first-class metadata.

Examples include:

- A dataset used by a workflow
- A model executed by a workflow
- A dataset generated by a workflow
- A component included in a workflow

These relationships will enable research assets to be represented as connected objects rather than isolated metadata records.

### 4. Connected FDO Publication

Develop the publication process for research assets, their metadata, and their relationships as connected FAIR Digital Objects.

This will include:

- Generating RO-Crate packages containing structured metadata and asset references.
- Preserving persistent identifiers and relationships between FDOs.
- Aligning metadata with LTER-LIFE catalogue requirements.
- Supporting publication and discovery of connected FDOs through the metadata catalogue.

## Related Platforms and Standards

- **NaaVRE:** Virtual Lab platform for composing and executing scientific workflows.
- **FDO Studio:** Integrated interface for research asset discovery, metadata harvesting, enrichment, and FDO preparation.
- **LTER-LIFE Metadata Catalogue:** Target catalogue for metadata publication and discovery.
- **RO-Crate:** Standard for packaging research artifacts with structured, machine-readable metadata.
- **Workflow RO-Crate:** Profile for describing computational workflows.
- **Workflow Run RO-Crate:** Profiles for describing workflow executions and provenance.
- **BioDT:** Reference project for existing workflow metadata practices and profiles.
- **FAIR Digital Objects:** Approach for representing research assets as identifiable, machine-actionable digital objects.

## References

- [RO-Crate Specification](https://www.researchobject.org/ro-crate/)
- [Workflow Run RO-Crate](https://www.researchobject.org/workflow-run-crate/)
- [FAIR Principles](https://www.go-fair.org/fair-principles/)

## Project Status

**Active development**

FDO Studio is integrated into NaaVRE, with research asset discovery and metadata harvesting supported through catalogue/repository, GitHub, and NaaVRE entry points.

Current development priorities include persistent identifier management, workflow execution metadata capture, explicit relationships between research assets, and publication of connected FAIR Digital Objects.
