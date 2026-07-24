use std::collections::HashMap;
use std::path::{Path, PathBuf};

use oxc::allocator::Allocator;
use oxc::ast::ast;
use oxc::ast_visit::Visit;
use oxc::parser::ParseOptions;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;

use super::types::{ReferenceInfo, SymbolInfo, SymbolLocation};

#[derive(Clone, Debug)]
pub struct IndexEntry {
    pub symbol: SymbolInfo,
    pub file_path: String,
    pub export_paths: Vec<String>,
}

pub struct SymbolIndex {
    symbols_by_name: HashMap<String, Vec<IndexEntry>>,
    exports_by_file: HashMap<String, Vec<IndexEntry>>,
    imports_by_file: HashMap<String, Vec<(String, String)>>,
}

impl SymbolIndex {
    pub fn new() -> Self {
        SymbolIndex {
            symbols_by_name: HashMap::new(),
            exports_by_file: HashMap::new(),
            imports_by_file: HashMap::new(),
        }
    }

    pub fn index_file(&mut self, file_path: &str, source_text: &str) {
        let (exports, imports) = parse_file_for_index(file_path, source_text);
        for entry in &exports {
            self.symbols_by_name
                .entry(entry.symbol.name.clone())
                .or_default()
                .push(entry.clone());
        }
        self.exports_by_file.insert(file_path.to_string(), exports);
        self.imports_by_file.insert(file_path.to_string(), imports);
    }

    pub fn index_files(&mut self, files: &[(String, String)]) {
        for (path, source) in files {
            self.index_file(path, source);
        }
    }

    pub fn resolve_symbol(
        &self,
        name: &str,
        from_file: Option<&str>,
    ) -> Option<&IndexEntry> {
        if let Some(from) = from_file {
            if let Some(imports) = self.imports_by_file.get(from) {
                for (imported_name, _source) in imports {
                    if imported_name == name {
                        if let Some(entries) = self.symbols_by_name.get(name) {
                            return entries.first();
                        }
                    }
                }
            }
        }
        self.symbols_by_name
            .get(name)
            .and_then(|entries| entries.first())
    }

    pub fn find_cross_file_references(&self, name: &str) -> Vec<(String, ReferenceInfo)> {
        let mut results = Vec::new();
        if let Some(entries) = self.symbols_by_name.get(name) {
            for entry in entries {
                results.push((
                    entry.file_path.clone(),
                    ReferenceInfo {
                        location: entry.symbol.location.clone(),
                        access: "definition".to_string(),
                    },
                ));
            }
        }
        results
    }

    pub fn get_file_exports(&self, file_path: &str) -> Option<&Vec<IndexEntry>> {
        self.exports_by_file.get(file_path)
    }
}

fn parse_file_for_index(
    file_path: &str,
    source_text: &str,
) -> (Vec<IndexEntry>, Vec<(String, String)>) {
    let path = Path::new(file_path);
    let source_type = SourceType::from_path(path).unwrap_or_default();

    let allocator = Allocator::default();
    let parse_ret = oxc::parser::Parser::new(&allocator, source_text, source_type)
        .with_options(ParseOptions {
            parse_regular_expression: true,
            ..ParseOptions::default()
        })
        .parse();

    let program = parse_ret.program;
    let semantic_ret = SemanticBuilder::new().build(&program);
    let semantic = &semantic_ret.semantic;
    let scoping = semantic.scoping();
    let line_index = super::analyzer::LineIndexRef::new(source_text);

    let mut exports: Vec<IndexEntry> = Vec::new();
    for symbol_id in scoping.symbol_ids() {
        let scope_id = scoping.symbol_scope_id(symbol_id);
        if scope_id == scoping.root_scope_id() {
            let name = scoping.symbol_name(symbol_id).to_string();
            let span = scoping.symbol_span(symbol_id);
            let (start_line, start_col) = line_index.line_col(span.start);
            let (end_line, end_col) = line_index.line_col(span.end);

            exports.push(IndexEntry {
                symbol: SymbolInfo {
                    name: name.clone(),
                    kind: "variable".to_string(),
                    location: SymbolLocation {
                        file_path: file_path.to_string(),
                        line: start_line,
                        column: start_col,
                        end_line,
                        end_column: end_col,
                    },
                    container_name: None,
                    is_exported: true,
                },
                file_path: file_path.to_string(),
                export_paths: vec![file_path.to_string()],
            });
        }
    }

    let mut imports: Vec<(String, String)> = Vec::new();
    let mut import_visitor = ImportVisitor { imports: &mut imports };
    import_visitor.visit_program(&program);

    (exports, imports)
}

struct ImportVisitor<'a> {
    imports: &'a mut Vec<(String, String)>,
}

impl<'a> Visit<'a> for ImportVisitor<'a> {
    fn visit_import_declaration(&mut self, it: &ast::ImportDeclaration<'_>) {
        let source = it.source.value.as_str().to_string();
        if let Some(specifiers) = &it.specifiers {
            for spec in specifiers.iter() {
                match &spec {
                    ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                        self.imports
                            .push((default.local.name.as_str().to_string(), source.clone()));
                    }
                    ast::ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        let name = module_export_name_to_string(&named.imported);
                        self.imports.push((name, source.clone()));
                    }
                    ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                        self.imports
                            .push((ns.local.name.as_str().to_string(), source.clone()));
                    }
                }
            }
        }
    }

    fn visit_export_named_declaration(&mut self, it: &ast::ExportNamedDeclaration<'_>) {
        if let Some(source) = &it.source {
            let source_str = source.value.as_str().to_string();
            for spec in it.specifiers.iter() {
                let name = module_export_name_to_string(&spec.local);
                self.imports.push((name, source_str.clone()));
            }
        }
    }
}

fn module_export_name_to_string(name: &ast::ModuleExportName<'_>) -> String {
    match name {
        ast::ModuleExportName::IdentifierName(id) => id.name.as_str().to_string(),
        ast::ModuleExportName::IdentifierReference(id) => id.name.as_str().to_string(),
        ast::ModuleExportName::StringLiteral(lit) => lit.value.as_str().to_string(),
    }
}

pub fn discover_source_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk_source_dir(root, &mut files);
    files.sort();
    files
}

fn walk_source_dir(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if is_skip_dir(name) {
                    continue;
                }
            }
            walk_source_dir(&path, files);
        } else if path.is_file() && is_source_file(&path) {
            files.push(path);
        }
    }
}

fn is_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | ".svn" | ".hg" | "target" | "dist" | "out" | "build"
            | ".next" | ".nuxt" | ".snow" | ".cache" | ".turbo" | "__pycache__"
            | ".pytest_cache" | ".venv" | "venv" | ".idea" | ".vscode" | "coverage"
            | ".nyc_output" | "release"
    )
}

fn is_source_file(path: &Path) -> bool {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_lowercase(),
        None => return false,
    };
    matches!(ext.as_str(), "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts")
}
