const fs = require('fs');
const path = require('path');
const toml = require('toml');

const sourcesDepPattern = "Requires: %{_cross_os}";
let brpath = path.resolve('./');

function addPath(paths, entryPath, sources) {
    let depPath = entryPath.replace(brpath + path.sep, "");
    if (paths.indexOf(depPath) == -1) {
        paths.push(depPath);
        processPackage(entryPath, paths, sources);
    }
}

function processPackage(cratePath, paths, sources) {
    let configPath = path.join(cratePath, "Cargo.toml");
    if (!fs.existsSync(configPath)) {
        console.log("%s doesn't exist", configPath);
        return paths;
    }

    let config = toml.parse(fs.readFileSync(configPath, "utf-8"));
    for (let entry in config["build-dependencies"]) {
        addPath(paths, path.resolve(path.join(cratePath, config["build-dependencies"][entry].path)), sources);
    }
    for (let entry in config["dependencies"]) {
        addPath(paths, path.resolve(path.join(cratePath, config["dependencies"][entry].path)), sources);
    }

    // Check for local sources in the spec file to find additional paths
    let crate = path.basename(cratePath);
    let specPath = path.join(cratePath, crate + ".spec");
    if (fs.existsSync(specPath)) {
        let input = fs.readFileSync(specPath, "utf-8");
        let lines = input.split("\n");
        for (var line of lines) {
            if (line.indexOf(sourcesDepPattern) != -1 && line.indexOf("BuildRequires") == -1) {
                let depName = line.replace(sourcesDepPattern, "").trim();
                if (depName in sources) {
                    for (var depPath of sources[depName]) {
                        if (paths.indexOf(depPath) == -1) {
                            paths.push(depPath);
                        }
                    }
                }
            }
        }
    }
}

function discoverVariants(sources, filterVariants) {
    let variantDirs = fs.readdirSync(
        path.join(brpath, 'variants'),
        { withFileTypes: true })
        .filter(de => de.isDirectory());

    let variantSets = {};
    let aarchEnemies = [];

    for (var variant of variantDirs) {
        let name = variant.name;
        if (name.includes('shared') || name.includes('target')) {
            continue;
        }

        if (name.includes('metal') || name.includes('vmware') || name.includes('-dev')) {
            aarchEnemies.push({ 'variant': name, 'arch': 'aarch64' });
        }

        let variantPath = path.join("variants", name);
        variantSets[name] = [variantPath];

        if (filterVariants) {
            processPackage(path.join(variant.path, name), variantSets[name], sources);

            // Always add a few paths for *-dev variants
            variantSets[name].push("Makefile.toml");
            variantSets[name].push(".github/actions");
            variantSets[name].push(".github/workflows");
        }
    }

    return { variantSets: variantSets, aarchEnemies: aarchEnemies };
}

function discoverSourceCrates(srcDir, sources, parentCrate = null) {
    let crate = path.basename(srcDir);
    if (crate == "migration") {
        // TODO: Remove this block if we start testing migrations in GH Actions
        return;
    }

    if (crate != "sources") {
        let cargo = path.join(srcDir, "Cargo.toml");
        if (fs.existsSync(cargo)) {
            let cratePath = srcDir.replace(brpath + path.sep, "");
            if (!(crate in sources)) {
                sources[crate] = [cratePath];
            }

            if (parentCrate != null && (sources[parentCrate].indexOf(cratePath) == -1)) {
                sources[parentCrate].push(cratePath);
            }

            if (parentCrate != null) {
                crate = parentCrate;
            }

            // Check for any local, relative dependencies
            // Note: we assume Cargo is making sure the dependency chain is sane
            // and does not contain loops.
            let config = toml.parse(fs.readFileSync(cargo, "utf-8"));
            for (let entry in config["build-dependencies"]) {
                let entryPath = config["build-dependencies"][entry].path;
                if (String(entryPath).indexOf("..") != -1) {
                    let depPath = path.resolve(path.join(srcDir, entryPath));
                    discoverSourceCrates(depPath, sources, crate);
                }
            }
            for (let entry in config["dependencies"]) {
                let entryPath = config["dependencies"][entry].path;
                if (String(entryPath).indexOf("..") != -1) {
                    let depPath = path.resolve(path.join(srcDir, entryPath));
                    discoverSourceCrates(depPath, sources, crate);
                }
            }

            // No need to look further down this path
            return;
        }
    }

    let subDirs = fs.readdirSync(
        srcDir,
        { withFileTypes: true })
        .filter(de => de.isDirectory());
    for (var subDir of subDirs) {
        discoverSourceCrates(path.join(subDir.path, subDir.name), sources);
    }
}

function getSourcePaths() {
    let sourceDir = path.join(brpath, "sources");
    let sources = {};
    discoverSourceCrates(sourceDir, sources);
    return sources;
}

module.exports.discoverVariants = discoverVariants;
module.exports.getSourcePaths = getSourcePaths;
