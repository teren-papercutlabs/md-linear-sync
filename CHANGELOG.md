# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2024-06-19

### Fixed
- **Duplicate title bug**: Fixed inconsistency where push operations preserved duplicate H1 titles while create operations removed them
- Both create and push operations now consistently remove duplicate H1 headers that match the frontmatter title
- Extracted duplicate removal logic into reusable utility for better maintainability

### Technical Details
- Added `contentProcessor.ts` utility with `removeDuplicateTitle()` function
- Updated `TicketFileParser.parseFile()` to apply duplicate removal across all operations
- Maintains backward compatibility while ensuring consistent behavior

## [0.2.1] - 2024-06-19

### Fixed
- Fixed TypeScript compilation errors
- Fixed build compilation and type safety issues

## [0.2.0] - 2024-06-19

### Added
- **Comment command**: New `npx md-linear-sync comment PAP-XXX "message"` functionality
- Full markdown support in comments (bold, lists, code blocks, emojis)
- Multi-line comment support with proper formatting
- Automatic webhook sync back to local files
- Real-time comment synchronization between Linear and local markdown files

### Enhanced
- Updated webhook system for bidirectional sync
- Updated error handling for API operations
- Added debugging and logging capabilities

## [0.1.x] - Previous Versions

### Features
- Linear ticket import and export
- Status-based folder organization
- Frontmatter metadata management
- Bidirectional sync between Linear and markdown
- Webhook listener for real-time updates
- Dependency resolution for ticket creation
- Validation system for ticket metadata