import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

const IGNORE_DIRS = process.env.ASTGEN_IGNORE_DIRS
  ? process.env.ASTGEN_IGNORE_DIRS.split(",")
  : [
      "venv",
      "docs",
      "test",
      "tests",
      "e2e",
      "examples",
      "cypress",
      "site-packages",
      "typings",
      "api_docs",
      "dev_docs",
      "types",
      "mock",
      "mocks",
      "jest-cache",
      "eslint-rules",
      "codemods",
      "flow-typed",
      "i18n",
      "coverage",
    ];

const IGNORE_FILE_PATTERN = new RegExp(
  process.env.ASTGEN_IGNORE_FILE_PATTERN ||
    "(conf|config|test|spec|mock|setup-jest|\\.d)\\.(js|ts|tsx)$",
  "i",
);

const getAllFiles = (deep, dir, extn, files, result, regex) => {
  files = files || readdirSync(dir);
  result = result || [];
  regex = regex || new RegExp(`\\${extn}$`);

  for (let i = 0; i < files.length; i++) {
    if (IGNORE_FILE_PATTERN.test(files[i]) || files[i].startsWith(".")) {
      continue;
    }
    const file = join(dir, files[i]);
    const fileStat = lstatSync(file);
    if (fileStat.isSymbolicLink()) {
      continue;
    }
    if (fileStat.isDirectory()) {
      // Ignore directories
      const dirName = basename(file);
      if (
        dirName.startsWith(".") ||
        dirName.startsWith("__") ||
        IGNORE_DIRS.includes(dirName.toLowerCase())
      ) {
        continue;
      }
      // We need to include node_modules in deep mode to track exports
      // Ignore only for non-deep analysis
      if (!deep && dirName === "node_modules") {
        continue;
      }
      try {
        result = getAllFiles(
          deep,
          file,
          extn,
          readdirSync(file),
          result,
          regex,
        );
      } catch (_error) {
        // ignore
      }
    } else {
      if (regex.test(file)) {
        result.push(file);
      }
    }
  }
  return result;
};

const babelParserOptions = {
  sourceType: "unambiguous",
  allowImportExportEverywhere: true,
  allowAwaitOutsideFunction: true,
  allowNewTargetOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowSuperOutsideMethod: true,
  errorRecovery: true,
  allowUndeclaredExports: true,
  createImportExpressions: true,
  tokens: true,
  attachComment: false,
  plugins: [
    "optionalChaining",
    "classProperties",
    "decorators-legacy",
    "exportDefaultFrom",
    "doExpressions",
    "numericSeparator",
    "dynamicImport",
    "jsx",
    "typescript",
  ],
};

/**
 * Filter only references to (t|jsx?) or (less|scss) files for now.
 * Opt to use our relative paths.
 */
const setFileRef = (
  allImports,
  allExports,
  src,
  file,
  pathnode,
  specifiers = [],
) => {
  const pathway = pathnode.value || pathnode.name;
  const sourceLoc = pathnode.loc?.start;
  if (!pathway) {
    return;
  }
  const fileRelativeLoc = relative(src, file);
  // remove unexpected extension imports
  if (/\.(svg|png|jpg|json|d\.ts)/.test(pathway)) {
    return;
  }
  const importedModules = specifiers
    .map((s) => s.imported?.name)
    .filter((v) => v !== undefined);
  const exportedModules = specifiers
    .map((s) => s.exported?.name)
    .filter((v) => v !== undefined);
  const occurrence = {
    importedAs: pathway,
    importedModules,
    exportedModules,
    isExternal: true,
    fileName: fileRelativeLoc,
    lineNumber: sourceLoc?.line ? sourceLoc.line : undefined,
    columnNumber: sourceLoc?.column ? sourceLoc.column : undefined,
  };
  // replace relative imports with full path
  let moduleFullPath = pathway;
  let wasAbsolute = false;
  if (/\.\//g.test(pathway) || /\.\.\//g.test(pathway)) {
    moduleFullPath = resolve(file, "..", pathway);
    if (isAbsolute(moduleFullPath)) {
      moduleFullPath = relative(src, moduleFullPath);
      wasAbsolute = true;
    }
    if (!moduleFullPath.startsWith("node_modules/")) {
      occurrence.isExternal = false;
    }
  }
  allImports[moduleFullPath] = allImports[moduleFullPath] || new Set();
  allImports[moduleFullPath].add(occurrence);

  // Handle module package name
  // Eg: zone.js/dist/zone will be referred to as zone.js in package.json
  if (!wasAbsolute && moduleFullPath.includes("/")) {
    const modPkg = moduleFullPath.split("/")[0];
    allImports[modPkg] = allImports[modPkg] || new Set();
    allImports[modPkg].add(occurrence);
  }
  if (exportedModules?.length) {
    moduleFullPath = moduleFullPath
      .replace("node_modules/", "")
      .replace("dist/", "")
      .replace(/\.(js|ts|cjs|mjs)$/g, "")
      .replace("src/", "");
    allExports[moduleFullPath] = allExports[moduleFullPath] || new Set();
    occurrence.exportedModules = exportedModules;
    allExports[moduleFullPath].add(occurrence);
  }
};

const vueCleaningRegex = /<\/*script.*>|<style[\s\S]*style>|<\/*br>/gi;
const vueTemplateRegex = /(<template.*>)([\s\S]*)(<\/template>)/gi;
const vueCommentRegex = /<!--[\s\S]*?-->/gi;
const vueBindRegex = /(:\[)([\s\S]*?)(\])/gi;
const vuePropRegex = /\s([.:@])([a-zA-Z]*?=)/gi;

const fileToParseableCode = (file) => {
  let code = readFileSync(file, "utf-8");
  if (file.endsWith(".vue") || file.endsWith(".svelte")) {
    code = code
      .replace(vueCommentRegex, (match) => match.replaceAll(/\S/g, " "))
      .replace(
        vueCleaningRegex,
        (match) => `${match.replaceAll(/\S/g, " ").substring(1)};`,
      )
      .replace(
        vueBindRegex,
        (_match, grA, grB, grC) =>
          grA.replaceAll(/\S/g, " ") + grB + grC.replaceAll(/\S/g, " "),
      )
      .replace(
        vuePropRegex,
        (_match, grA, grB) => ` ${grA.replace(/[.:@]/g, " ")}${grB}`,
      )
      .replace(
        vueTemplateRegex,
        (_match, grA, grB, grC) =>
          grA + grB.replaceAll("{{", "{ ").replaceAll("}}", " }") + grC,
      );
  }
  return code;
};

/**
 * Check AST tree for any (j|tsx?) files and set a file
 * references for any import, require or dynamic import files.
 */
const parseFileASTTree = (src, file, allImports, allExports) => {
  const ast = parse(fileToParseableCode(file), babelParserOptions);
  traverse.default(ast, {
    ImportDeclaration: (path) => {
      if (path?.node) {
        setFileRef(
          allImports,
          allExports,
          src,
          file,
          path.node.source,
          path.node.specifiers,
        );
      }
    },
    // For require('') statements
    Identifier: (path) => {
      if (
        path?.node &&
        path.node.name === "require" &&
        path.parent.type === "CallExpression"
      ) {
        setFileRef(allImports, allExports, src, file, path.parent.arguments[0]);
      }
    },
    // Use for dynamic imports like routes.jsx
    CallExpression: (path) => {
      if (path?.node && path.node.callee.type === "Import") {
        setFileRef(allImports, allExports, src, file, path.node.arguments[0]);
      }
    },
    // Use for export barrells
    ExportAllDeclaration: (path) => {
      setFileRef(allImports, allExports, src, file, path.node.source);
    },
    ExportNamedDeclaration: (path) => {
      // ensure there is a path export
      if (path?.node?.source) {
        setFileRef(
          allImports,
          allExports,
          src,
          file,
          path.node.source,
          path.node.specifiers,
        );
      }
    },
  });
};

/**
 * Return paths to all (j|tsx?) files.
 */
const getAllSrcJSAndTSFiles = (src, deep) =>
  Promise.all([
    getAllFiles(deep, src, ".js"),
    getAllFiles(deep, src, ".jsx"),
    getAllFiles(deep, src, ".cjs"),
    getAllFiles(deep, src, ".mjs"),
    getAllFiles(deep, src, ".ts"),
    getAllFiles(deep, src, ".tsx"),
    getAllFiles(deep, src, ".vue"),
    getAllFiles(deep, src, ".svelte"),
  ]);

/**
 * Find all imports and exports
 */
export const findJSImportsExports = async (src, deep) => {
  const allImports = {};
  const allExports = {};
  const errFiles = [];
  try {
    const promiseMap = await getAllSrcJSAndTSFiles(src, deep);
    const srcFiles = promiseMap.flat();
    for (const file of srcFiles) {
      try {
        parseFileASTTree(src, file, allImports, allExports);
      } catch (_err) {
        errFiles.push(file);
      }
    }
    return { allImports, allExports };
  } catch (_err) {
    return { allImports, allExports };
  }
};

/**
 * Convert allImports map to CycloneDX evidence.occurrences format
 * 
 * @param {Object} allImports Map of package names to Sets of occurrence objects
 * @returns {Object} Map of package names to arrays of occurrence objects with location field
 */
export const extractOccurrences = (allImports) => {
  const occurrenceMap = {}; // {packageName: [{location: file}]}
  
  for (const [pkgName, occurrenceSet] of Object.entries(allImports)) {
    // Skip internal/relative imports
    if (pkgName.startsWith('.') || pkgName.includes('../')) {
      continue;
    }
    
    const occurrences = [];
    const seenLocations = new Set(); // Deduplicate file locations
    
    for (const occ of occurrenceSet) {
      // Only include external imports (npm packages)
      if (occ.isExternal && occ.fileName) {
        const location = occ.fileName;
        if (!seenLocations.has(location)) {
          seenLocations.add(location);
          occurrences.push({ location });
        }
      }
    }
    
    if (occurrences.length > 0) {
      occurrenceMap[pkgName] = occurrences;
    }
  }
  
  return occurrenceMap;
};

/**
 * Find all Java imports in source files
 * 
 * @param {string} src Source directory
 * @returns {Object} Map of package names to arrays of occurrence objects
 */
export const findJavaImports = (src) => {
  const allImports = {}; // {packageName: Set({fileName})}
  
  try {
    // Synchronous file search for Java files
    const findJavaFilesRecursive = (dir, files = []) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip common non-source directories
            if (!['target', 'build', 'node_modules', 'test', 'tests'].includes(entry.name)) {
              findJavaFilesRecursive(fullPath, files);
            }
          } else if (entry.isFile() && entry.name.endsWith('.java')) {
            files.push(fullPath);
          }
        }
      } catch (_err) {
        // Skip directories we can't read
      }
      return files;
    };
    
    const javaFiles = findJavaFilesRecursive(src);
    
    // Regex patterns for Java imports
    const importPattern = /^\s*import\s+(static\s+)?([a-zA-Z0-9_.]+)\s*;/gm;
    
    for (const file of javaFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        const fileRelativeLoc = relative(src, file);
        
        let match;
        while ((match = importPattern.exec(content)) !== null) {
          const isStatic = match[1];
          const importPath = match[2];
          
          // Skip java.*, javax.*, sun.* (standard library)
          if (importPath.startsWith('java.') || 
              importPath.startsWith('javax.') || 
              importPath.startsWith('sun.') ||
              importPath.startsWith('jdk.')) {
            continue;
          }
          
          // Extract the package root (e.g., org.springframework from org.springframework.boot.SpringApplication)
          // Most Maven artifacts use at least 2 segments (e.g., org.springframework)
          const parts = importPath.split('.');
          if (parts.length >= 2) {
            // Try to map to likely package names
            // Common patterns: org.springframework.* -> org.springframework
            const packageKey = `${parts[0]}.${parts[1]}`;
            
            if (!allImports[packageKey]) {
              allImports[packageKey] = new Set();
            }
            allImports[packageKey].add(fileRelativeLoc);
            
            // Also try 3-segment key for more specific packages (org.springframework.boot)
            if (parts.length >= 3) {
              const packageKey3 = `${parts[0]}.${parts[1]}.${parts[2]}`;
              if (!allImports[packageKey3]) {
                allImports[packageKey3] = new Set();
              }
              allImports[packageKey3].add(fileRelativeLoc);
            }
          }
        }
      } catch (_err) {
        // Skip files we can't read or parse
      }
    }
  } catch (_err) {
    // Return empty if file search fails
  }
  
  return allImports;
};

/**
 * Find all Ruby requires/imports in source files
 * 
 * @param {string} src Source directory
 * @returns {Object} Map of gem names to arrays of occurrence objects
 */
export const findRubyImports = (src) => {
  const allImports = {}; // {gemName: Set({fileName})}
  
  try {
    const findRubyFiles = (dir, files = []) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip common non-source directories
            if (!['vendor', 'node_modules', 'test', 'spec', 'tmp', 'log'].includes(entry.name)) {
              findRubyFiles(fullPath, files);
            }
          } else if (entry.isFile() && entry.name.endsWith('.rb')) {
            files.push(fullPath);
          }
        }
      } catch (_err) {
        // Skip directories we can't read
      }
      return files;
    };
    
    const rubyFiles = findRubyFiles(src);
    
    // Regex patterns for Ruby requires
    const patterns = [
      /^\s*require\s+['"]([^'"]+)['"]/gm,           // require 'gem_name'
      /^\s*require_relative\s+['"]([^'"]+)['"]/gm,  // require_relative (skip - internal)
      /^\s*gem\s+['"]([^'"]+)['"]/gm,               // gem 'gem_name' (in Gemfile)
      /^\s*load\s+['"]([^'"]+)['"]/gm,              // load 'file.rb'
    ];
    
    for (const file of rubyFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        const fileRelativeLoc = relative(src, file);
        const fileName = basename(file);
        
        for (const pattern of patterns) {
          let match;
          const patternClone = new RegExp(pattern.source, pattern.flags);
          
          while ((match = patternClone.exec(content)) !== null) {
            const gemName = match[1];
            
            // Skip relative requires (internal files)
            if (gemName.startsWith('.') || gemName.startsWith('/')) {
              continue;
            }
            
            // Skip file extensions (these are internal files)
            if (gemName.endsWith('.rb')) {
              continue;
            }
            
            // Only process Gemfile patterns from actual Gemfile
            if (pattern.source.includes('gem\\s+') && !fileName.includes('Gemfile')) {
              continue;
            }
            
            if (!allImports[gemName]) {
              allImports[gemName] = new Set();
            }
            allImports[gemName].add(fileRelativeLoc);
          }
        }
      } catch (_err) {
        // Skip files we can't read or parse
      }
    }
  } catch (_err) {
    // Return empty if file search fails
  }
  
  return allImports;
};

