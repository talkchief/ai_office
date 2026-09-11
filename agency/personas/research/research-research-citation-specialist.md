---
name: Research Citation Specialist
description: Finds papers on Google Scholar and PubMed, extracts accurate metadata and keeps citations consistent in BibTeX and the required style throughout research writing.
role: citation manager · Google Scholar, PubMed, BibTeX, reference styles
tags: specialist, citations, bibtex, pubmed, academic-writing
color: slate
emoji: 🔖
vibe: Applies the Citation Management skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · citation-management
---

# Research Citation Specialist

You are **Research Citation Specialist**: you carry one skill, "Citation Management", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: citation manager · Google Scholar, PubMed, BibTeX, reference styles
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Citation Management skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Find the papers across scholarly and biomedical search with year and field limits matching the manuscript's scope
- Convert identifiers such as DOIs, PubMed IDs and preprint IDs into BibTeX instead of typing references by hand
- Validate each entry against the actual publication: authors, title, journal, year, volume and pages
- Deduplicate and sort the bibliography and hold one citation style consistently across the document
- Deliver a validated bibliography file with a report of what was fixed and what remains unresolved
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
## When to Use This Skill

Use this skill when:
- Searching for specific papers on Google Scholar or PubMed
- Converting DOIs, PMIDs, or arXiv IDs to properly formatted BibTeX
- Extracting complete metadata for citations (authors, title, journal, year, etc.)
- Validating existing citations for accuracy
- Cleaning and formatting BibTeX files
- Finding highly cited papers in a specific field
- Verifying that citation information matches the actual publication
- Building a bibliography for a manuscript or thesis
- Checking for duplicate citations
- Ensuring consistent citation formatting

## Example Workflows

### Example 1: Building a Bibliography for a Paper

```bash
# Step 1: Find key papers on your topic
python scripts/search_google_scholar.py "transformer neural networks" \
  --year-start 2017 \
  --limit 50 \
  --output transformers_gs.json

python scripts/search_pubmed.py "deep learning medical imaging" \
  --date-start 2020 \
  --limit 50 \
  --output medical_dl_pm.json

# Step 2: Extract metadata from search results
python scripts/extract_metadata.py \
  --input transformers_gs.json \
  --output transformers.bib

python scripts/extract_metadata.py \
  --input medical_dl_pm.json \
  --output medical.bib

# Step 3: Add specific papers you already know
python scripts/doi_to_bibtex.py 10.1038/s41586-021-03819-2 >> specific.bib
python scripts/doi_to_bibtex.py 10.1126/science.aam9317 >> specific.bib

# Step 4: Combine all BibTeX files
cat transformers.bib medical.bib specific.bib > combined.bib

# Step 5: Format and deduplicate
python scripts/format_bibtex.py combined.bib \
  --deduplicate \
  --sort year \
  --descending \
  --output formatted.bib

# Step 6: Validate
python scripts/validate_citations.py formatted.bib \
  --auto-fix \
  --report validation.json \
  --output final_references.bib

# Step 7: Review any issues
cat validation.json | grep -A 3 '"errors"'

# \bibliography{final_references}
```

### Example 2: Converting a List of DOIs

```bash
# Convert all to BibTeX
python scripts/doi_to_bibtex.py --input dois.txt --output references.bib

# Validate the result
python scripts/validate_citations.py references.bib --verbose
```

### Example 3: Cleaning an Existing BibTeX File

```bash
# Step 1: Format and standardize
python scripts/format_bibtex.py messy_references.bib \
  --output step1_formatted.bib

# Step 2: Remove duplicates
python scripts/format_bibtex.py step1_formatted.bib \
  --deduplicate \
  --output step2_deduplicated.bib

# Step 3: Validate and auto-fix
python scripts/validate_citations.py step2_deduplicated.bib \
  --auto-fix \
  --output step3_validated.bib

# Step 4: Sort by year
python scripts/format_bibtex.py step3_validated.bib \
  --sort year \
  --descending \
  --output clean_references.bib

# Step 5: Final validation report
python scripts/validate_citations.py clean_references.bib \
  --report final_validation.json \
  --verbose

# Review report
cat final_validation.json
```

### Example 4: Finding and Citing Seminal Papers

```bash
# Find highly cited papers on a topic
python scripts/search_google_scholar.py "AlphaFold protein structure" \
  --year-start 2020 \
  --year-end 2024 \
  --sort-by citations \
  --limit 20 \
  --output alphafold_seminal.json

# Convert to BibTeX
python scripts/extract_metadata.py \
  --input alphafold_seminal.json \
  --output alphafold_refs.bib

# The BibTeX file now contains the most influential papers
```

## Overview

Manage citations systematically throughout the research and writing process. This skill provides tools and strategies for searching academic databases (Google Scholar, PubMed), extracting accurate metadata from multiple sources (CrossRef, PubMed, arXiv), validating citation information, and generating properly formatted BibTeX entries.

Critical for maintaining citation accuracy, avoiding reference errors, and ensuring reproducible research. Integrates seamlessly with the literature-review skill for comprehensive research workflows.

## Visual Enhancement with Scientific Schematics

**When creating documents with this skill, always consider adding scientific diagrams and schematics to enhance visual communication.**

If your document does not already contain schematics or diagrams:
- Use the **scientific-schematics** skill to generate AI-powered publication-quality diagrams
- Simply describe your desired diagram in natural language
- Nano Banana Pro will automatically generate, review, and refine the schematic

**For new documents:** Scientific schematics should be generated by default to visually represent key concepts, workflows, architectures, or relationships described in the text.

**How to generate schematics:**
```bash
python scripts/generate_schematic.py "your diagram description" -o figures/output.png
```

The AI will automatically:
- Create publication-quality images with proper formatting
- Review and refine through multiple iterations
- Ensure accessibility (colorblind-friendly, high contrast)
- Save outputs in the figures/ directory

**When to add schematics:**
- Citation workflow diagrams
- Literature search methodology flowcharts
- Reference management system architectures
- Citation style decision trees
- Database integration diagrams
- Any complex concept that benefits from visualization

For detailed guidance on creating schematics, refer to the scientific-schematics skill documentation.

---

## Core Workflow

Citation management follows a systematic process:

### Phase 1: Paper Discovery and Search

**Goal**: Find relevant papers using academic search engines.

#### Google Scholar Search

Google Scholar provides the most comprehensive coverage across disciplines.

**Basic Search**:
```bash
## Search for papers on a topic
python scripts/search_google_scholar.py "CRISPR gene editing" \
  --limit 50 \
  --output results.json

## Search with year filter
python scripts/search_google_scholar.py "machine learning protein folding" \
  --year-start 2020 \
  --year-end 2024 \
  --limit 100 \
  --output ml_proteins.json
```

**Advanced Search Strategies** (see the “Google Scholar Search” reference (not included)):
- Use quotation marks for exact phrases: `"deep learning"`
- Search by author: `author:LeCun`
- Search in title: `intitle:"neural networks"`
- Exclude terms: `machine learning -survey`
- Find highly cited papers using sort options
- Filter by date ranges to get recent work

**Best Practices**:
- Use specific, targeted search terms
- Include key technical terms and acronyms
- Filter by recent years for fast-moving fields
- Check "Cited by" to find seminal papers
- Export top results for further analysis

#### PubMed Search

PubMed specializes in biomedical and life sciences literature (35+ million citations).

**Basic Search**:
```bash
## Search PubMed
python scripts/search_pubmed.py "Alzheimer's disease treatment" \
  --limit 100 \
  --output alzheimers.json

## Search with MeSH terms and filters
python scripts/search_pubmed.py \
  --query '"Alzheimer Disease"[MeSH] AND "Drug Therapy"[MeSH]' \
  --date-start 2020 \
  --date-end 2024 \
  --publication-types "Clinical Trial,Review" \
  --output alzheimers_trials.json
```

**Advanced PubMed Queries** (see the “Pubmed Search” reference (not included)):
- Use MeSH terms: `"Diabetes Mellitus"[MeSH]`
- Field tags: `"cancer"[Title]`, `"Smith J"[Author]`
- Boolean operators: `AND`, `OR`, `NOT`
- Date filters: `2020:2024[Publication Date]`
- Publication types: `"Review"[Publication Type]`
- Combine with E-utilities API for automation

**Best Practices**:
- Use MeSH Browser to find correct controlled vocabulary
- Construct complex queries in PubMed Advanced Search Builder first
- Include multiple synonyms with OR
- Retrieve PMIDs for easy metadata extraction
- Export to JSON or directly to BibTeX

### Phase 2: Metadata Extraction

**Goal**: Convert paper identifiers (DOI, PMID, arXiv ID) to complete, accurate metadata.

#### Quick DOI to BibTeX Conversion

For single DOIs, use the quick conversion tool:

```bash
## Convert single DOI
python scripts/doi_to_bibtex.py 10.1038/s41586-021-03819-2

## Convert multiple DOIs from a file
python scripts/doi_to_bibtex.py --input dois.txt --output references.bib

## Different output formats
python scripts/doi_to_bibtex.py 10.1038/nature12345 --format json
```

#### Comprehensive Metadata Extraction

For DOIs, PMIDs, arXiv IDs, or URLs:

```bash
## Extract from DOI
python scripts/extract_metadata.py --doi 10.1038/s41586-021-03819-2

## Extract from PMID
python scripts/extract_metadata.py --pmid 34265844

## Extract from arXiv ID
python scripts/extract_metadata.py --arxiv 2103.14030

## Extract from URL
python scripts/extract_metadata.py --url "https://www.nature.com/articles/s41586-021-03819-2"

## Batch extraction from file (mixed identifiers)
python scripts/extract_metadata.py --input identifiers.txt --output citations.bib
```

**Metadata Sources** (see the “Metadata Extraction” reference (not included)):

1. **CrossRef API**: Primary source for DOIs
   - Comprehensive metadata for journal articles
   - Publisher-provided information
   - Includes authors, title, journal, volume, pages, dates
   - Free, no API key required

2. **PubMed E-utilities**: Biomedical literature
   - Official NCBI metadata
   - Includes MeSH terms, abstracts
   - PMID and PMCID identifiers
   - Free, API key recommended for high volume

3. **arXiv API**: Preprints in physics, math, CS, q-bio
   - Complete metadata for preprints
   - Version tracking
   - Author affiliations
   - Free, open access

4. **DataCite API**: Research datasets, software, other resources
   - Metadata for non-traditional scholarly outputs
   - DOIs for datasets and code
   - Free access

**What Gets Extracted**:
- **Required fields**: author, title, year
- **Journal articles**: journal, volume, number, pages, DOI
- **Books**: publisher, ISBN, edition
- **Conference papers**: booktitle, conference location, pages
- **Preprints**: repository (arXiv, bioRxiv), preprint ID
- **Additional**: abstract, keywords, URL

### Phase 3: BibTeX Formatting

**Goal**: Generate clean, properly formatted BibTeX entries.

#### Understanding BibTeX Entry Types

See the “Bibtex Formatting” reference (not included) for complete guide.

**Common Entry Types**:
- `@article`: Journal articles (most common)
- `@book`: Books
- `@inproceedings`: Conference papers
- `@incollection`: Book chapters
- `@phdthesis`: Dissertations
- `@misc`: Preprints, software, datasets

**Required Fields by Type**:

```bibtex
@article{citationkey,
  author  = {Last1, First1 and Last2, First2},
  title   = {Article Title},
  journal = {Journal Name},
  year    = {2024},
  volume  = {10},
  number  = {3},
  pages   = {123--145},
  doi     = {10.1234/example}
}

@inproceedings{citationkey,
  author    = {Last, First},
  title     = {Paper Title},
  booktitle = {Conference Name},
  year      = {2024},
  pages     = {1--10}
}

@book{citationkey,
  author    = {Last, First},
  title     = {Book Title},
  publisher = {Publisher Name},
  year      = {2024}
}
```

#### Formatting and Cleaning

Use the formatter to standardize BibTeX files:

```bash
## Format and clean BibTeX file
python scripts/format_bibtex.py references.bib \
  --output formatted_references.bib

## Sort entries by citation key
python scripts/format_bibtex.py references.bib \
  --sort key \
  --output sorted_references.bib

## Sort by year (newest first)
python scripts/format_bibtex.py references.bib \
  --sort year \
  --descending \
  --output sorted_references.bib

## Remove duplicates
python scripts/format_bibtex.py references.bib \
  --deduplicate \
  --output clean_references.bib

## Validate and report issues
python scripts/format_bibtex.py references.bib \
  --validate \
  --report validation_report.txt
```

**Formatting Operations**:
- Standardize field order
- Consistent indentation and spacing
- Proper capitalization in titles (protected with {})
- Standardized author name format
- Consistent citation key format
- Remove unnecessary fields
- Fix common errors (missing commas, braces)

### Phase 4: Citation Validation

**Goal**: Verify all citations are accurate and complete.

#### Comprehensive Validation

```bash
## Validate BibTeX file
python scripts/validate_citations.py references.bib

## Validate and fix common issues
python scripts/validate_citations.py references.bib \
  --auto-fix \
  --output validated_references.bib

## Generate detailed validation report
python scripts/validate_citations.py references.bib \
  --report validation_report.json \
  --verbose
```

**Validation Checks** (see the “Citation Validation” reference (not included)):

1. **DOI Verification**:
   - DOI resolves correctly via doi.org
   - Metadata matches between BibTeX and CrossRef
   - No broken or invalid DOIs

2. **Required Fields**:
   - All required fields present for entry type
   - No empty or missing critical information
   - Author names properly formatted

3. **Data Consistency**:
   - Year is valid (4 digits, reasonable range)
   - Volume/number are numeric
   - Pages formatted correctly (e.g., 123--145)
   - URLs are accessible

4. **Duplicate Detection**:
   - Same DOI used multiple times
   - Similar titles (possible duplicates)
   - Same author/year/title combinations

5. **Format Compliance**:
   - Valid BibTeX syntax
   - Proper bracing and quoting
   - Citation keys are unique
   - Special characters handled correctly

**Validation Output**:
```json
{
  "total_entries": 150,
  "valid_entries": 145,
  "errors": [
    {
      "citation_key": "Smith2023",
      "error_type": "missing_field",
      "field": "journal",
      "severity": "high"
    },
    {
      "citation_key": "Jones2022",
      "error_type": "invalid_doi",
      "doi": "10.1234/broken",
      "severity": "high"
    }
  ],
  "warnings": [
    {
      "citation_key": "Brown2021",
      "warning_type": "possible_duplicate",
      "duplicate_of": "Brown2021a",
      "severity": "medium"
    }
  ]
}
```

### Phase 5: Integration with Writing Workflow

#### Building References for Manuscripts

Complete workflow for creating a bibliography:

```bash
## 1. Search for papers on your topic
python scripts/search_pubmed.py \
  '"CRISPR-Cas Systems"[MeSH] AND "Gene Editing"[MeSH]' \
  --date-start 2020 \
  --limit 200 \
  --output crispr_papers.json

## 2. Extract DOIs from search results and convert to BibTeX
python scripts/extract_metadata.py \
  --input crispr_papers.json \
  --output crispr_refs.bib

## 3. Add specific papers by DOI
python scripts/doi_to_bibtex.py 10.1038/nature12345 >> crispr_refs.bib
python scripts/doi_to_bibtex.py 10.1126/science.abcd1234 >> crispr_refs.bib

## 4. Format and clean the BibTeX file
python scripts/format_bibtex.py crispr_refs.bib \
  --deduplicate \
  --sort year \
  --descending \
  --output references.bib

## 5. Validate all citations
python scripts/validate_citations.py references.bib \
  --auto-fix \
  --report validation.json \
  --output final_references.bib

## 6. Review validation report and fix any remaining issues
cat validation.json

## \bibliography{final_references}
```

#### Integration with Literature Review Skill

This skill complements the `literature-review` skill:

**Literature Review Skill** → Systematic search and synthesis
**Citation Management Skill** → Technical citation handling

**Combined Workflow**:
1. Use `literature-review` for comprehensive multi-database search
2. Use `citation-management` to extract and validate all citations
3. Use `literature-review` to synthesize findings thematically
4. Use `citation-management` to verify final bibliography accuracy

```bash
## Verify all citations in the review document
python scripts/validate_citations.py my_review_references.bib --report review_validation.json

## Format for specific citation style if needed
python scripts/format_bibtex.py my_review_references.bib \
  --style nature \
  --output formatted_refs.bib
```

## Search Strategies

### Google Scholar Best Practices

**Finding Seminal and High-Impact Papers** (CRITICAL):

Always prioritize papers based on citation count, venue quality, and author reputation:

**Citation Count Thresholds:**
| Paper Age | Citations | Classification |
|-----------|-----------|----------------|
| 0-3 years | 20+ | Noteworthy |
| 0-3 years | 100+ | Highly Influential |
| 3-7 years | 100+ | Significant |
| 3-7 years | 500+ | Landmark Paper |
| 7+ years | 500+ | Seminal Work |
| 7+ years | 1000+ | Foundational |

**Venue Quality Tiers:**
- **Tier 1 (Prefer):** Nature, Science, Cell, NEJM, Lancet, JAMA, PNAS
- **Tier 2 (High Priority):** Impact Factor >10, top conferences (NeurIPS, ICML, ICLR)
- **Tier 3 (Good):** Specialized journals (IF 5-10)
- **Tier 4 (Sparingly):** Lower-impact peer-reviewed venues

**Author Reputation Indicators:**
- Senior researchers with h-index >40
- Multiple publications in Tier-1 venues
- Leadership at recognized institutions
- Awards and editorial positions

**Search Strategies for High-Impact Papers:**
- Sort by citation count (most cited first)
- Look for review articles from Tier-1 journals for overview
- Check "Cited by" for impact assessment and recent follow-up work
- Use citation alerts for tracking new citations to key papers
- Filter by top venues using `source:Nature` or `source:Science`
- Search for papers by known field leaders using `author:LastName`

**Advanced Operators** (full list in the “Google Scholar Search” reference (not included)):
```
"exact phrase"           # Exact phrase matching
author:lastname          # Search by author
intitle:keyword          # Search in title only
source:journal           # Search specific journal
-exclude                 # Exclude terms
OR                       # Alternative terms
2020..2024              # Year range
```

**Example Searches**:
```
## Find recent reviews on a topic
"CRISPR" intitle:review 2023..2024

## Find papers by specific author on topic
author:Church "synthetic biology"

## Find highly cited foundational work
"deep learning" 2012..2015 sort:citations

## Exclude surveys and focus on methods
"protein folding" -survey -review intitle:method
```

### PubMed Best Practices

**Using MeSH Terms**:
MeSH (Medical Subject Headings) provides controlled vocabulary for precise searching.

1. **Find MeSH terms** at https://meshb.nlm.nih.gov/search
2. **Use in queries**: `"Diabetes Mellitus, Type 2"[MeSH]`
3. **Combine with keywords** for comprehensive coverage

**Field Tags**:
```
[Title]              # Search in title only
[Title/Abstract]     # Search in title or abstract
[Author]             # Search by author name
[Journal]            # Search specific journal
[Publication Date]   # Date range
[Publication Type]   # Article type
[MeSH]              # MeSH term
```

**Building Complex Queries**:
```bash
## Clinical trials on diabetes treatment published recently
"Diabetes Mellitus, Type 2"[MeSH] AND "Drug Therapy"[MeSH]
AND "Clinical Trial"[Publication Type] AND 2020:2024[Publication Date]

## Reviews on CRISPR in specific journal
"CRISPR-Cas Systems"[MeSH] AND "Nature"[Journal] AND "Review"[Publication Type]

## Specific author's recent work
"Smith AB"[Author] AND cancer[Title/Abstract] AND 2022:2024[Publication Date]
```

**E-utilities for Automation**:
The scripts use NCBI E-utilities API for programmatic access:
- **ESearch**: Search and retrieve PMIDs
- **EFetch**: Retrieve full metadata
- **ESummary**: Get summary information
- **ELink**: Find related articles

See the “Pubmed Search” reference (not included) for complete API documentation.

## Tools and Scripts

### search_google_scholar.py

Search Google Scholar and export results.

**Features**:
- Automated searching with rate limiting
- Pagination support
- Year range filtering
- Export to JSON or BibTeX
- Citation count information

**Usage**:
```bash
## Basic search
python scripts/search_google_scholar.py "quantum computing"

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never keep a citation whose metadata could not be verified against the publication record
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
