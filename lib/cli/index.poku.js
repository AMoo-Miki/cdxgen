import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

describe("CLI tests", () => {
  describe("submitBom()", () => {
    it("should successfully report the SBOM with given project id, name, version and a single tag", async () => {
      const fakeGotResponse = {
        json: sinon.stub().resolves({ success: true }),
      };

      const gotStub = sinon.stub().returns(fakeGotResponse);
      gotStub.extend = sinon.stub().returns(gotStub);

      const { submitBom } = await esmock("./index.js", {
        got: { default: gotStub },
      });

      const serverUrl = "https://dtrack.example.com";
      const projectId = "f7cb9f02-8041-4991-9101-b01fa07a6522";
      const projectName = "cdxgen-test-project";
      const projectVersion = "1.0.0";
      const projectTag = "tag1";
      const bomContent = { bom: "test" };
      const apiKey = "TEST_API_KEY";
      const skipDtTlsCheck = false;

      const expectedRequestPayload = {
        autoCreate: "true",
        bom: "eyJib20iOiJ0ZXN0In0=", // stringified and base64 encoded bomContent
        project: projectId,
        projectName,
        projectVersion,
        projectTags: [{ name: projectTag }],
      };

      await submitBom(
        {
          serverUrl,
          projectId,
          projectName,
          projectVersion,
          apiKey,
          skipDtTlsCheck,
          projectTag,
        },
        bomContent,
      );

      // Verify got was called exactly once
      sinon.assert.calledOnce(gotStub);

      // Grab call arguments
      const [calledUrl, options] = gotStub.firstCall.args;

      assert.equal(calledUrl, `${serverUrl}/api/v1/bom`);
      assert.equal(options.method, "PUT");
      assert.equal(options.https.rejectUnauthorized, !skipDtTlsCheck);
      assert.equal(options.headers["X-Api-Key"], apiKey);
      assert.match(options.headers["user-agent"], /@CycloneDX\/cdxgen/);
      assert.deepEqual(options.json, expectedRequestPayload);
    });

    it("should successfully report the SBOM with given parent project, name, version and multiple tags", async () => {
      const fakeGotResponse = {
        json: sinon.stub().resolves({ success: true }),
      };

      const gotStub = sinon.stub().returns(fakeGotResponse);
      gotStub.extend = sinon.stub().returns(gotStub);

      const { submitBom } = await esmock("./index.js", {
        got: { default: gotStub },
      });

      const serverUrl = "https://dtrack.example.com";
      const projectName = "cdxgen-test-project";
      const projectVersion = "1.1.0";
      const projectTags = ["tag1", "tag2"];
      const parentProjectId = "5103b8b4-4ca3-46ea-8051-036a3b2ab17e";
      const bomContent = {
        bom: "test2",
      };
      const apiKey = "TEST_API_KEY";
      const skipDtTlsCheck = false;

      const expectedRequestPayload = {
        autoCreate: "true",
        bom: "eyJib20iOiJ0ZXN0MiJ9", // stringified and base64 encoded bomContent
        parentUUID: parentProjectId,
        projectName,
        projectVersion,
        projectTags: [{ name: projectTags[0] }, { name: projectTags[1] }],
      };

      await submitBom(
        {
          serverUrl,
          parentProjectId,
          projectName,
          projectVersion,
          apiKey,
          skipDtTlsCheck,
          projectTag: projectTags,
        },
        bomContent,
      );

      // Verify got was called exactly once
      sinon.assert.calledOnce(gotStub);

      // Grab call arguments
      const [calledUrl, options] = gotStub.firstCall.args;

      // Assert call arguments against expectations
      assert.equal(calledUrl, `${serverUrl}/api/v1/bom`);
      assert.equal(options.method, "PUT");
      assert.equal(options.https.rejectUnauthorized, !skipDtTlsCheck);
      assert.equal(options.headers["X-Api-Key"], apiKey);
      assert.match(options.headers["user-agent"], /@CycloneDX\/cdxgen/);
      assert.deepEqual(options.json, expectedRequestPayload);
    });
  });

  describe("addComponent() with GitHub/GitLab/Bitbucket URLs", () => {
    it("should create proper PURL for GitHub git URL with tag", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "my-package",
        version: "git+https://git@github.com/user/repo.git#v1.0.0",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:github/user/repo@v1.0.0", "should have correct GitHub PURL with user/repo");
      assert.equal(components[0].name, "repo", "should extract repo name from URL");
      assert.equal(components[0].group, "user", "should extract user/org from URL");
      assert.deepStrictEqual(components[0].supplier, { name: "github" }, "should set supplier to github");
    });

    it("should create proper PURL for Bitbucket git URL with branch", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "bitbucket-package",
        version: "git+https://git@bitbucket.org/company/library.git#main",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:bitbucket/company/library@main", "should have correct Bitbucket PURL with company/library");
      assert.equal(components[0].name, "library", "should extract repo name from URL");
      assert.equal(components[0].group, "company", "should extract org from URL");
    });

    it("should create proper PURL for GitHub URL with commit/branch ref", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "commit-package",
        version: "git+https://git@github.com/user/repo.git#abc123def456",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:github/user/repo@abc123def456", "should have correct GitHub PURL with commit/branch ref");
      assert.equal(components[0].name, "repo", "should extract repo name from URL");
      assert.equal(components[0].group, "user", "should extract user from URL");
    });

    it("should create proper PURL for GitLab URL with tag", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "gitlab-package",
        version: "git+https://git@gitlab.com/user/project.git#v1.0.0",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:gitlab/user/project@v1.0.0", "should have correct GitLab PURL");
      assert.equal(components[0].name, "project", "should extract project name from URL");
      assert.equal(components[0].group, "user", "should extract user from URL");
    });

    it("should create proper PURL for GitLab URL with nested groups", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "nested-package",
        version: "git+ssh://git@gitlab.com/group/subgroup/project.git#main",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:gitlab/group/subgroup/project@main", "should have correct GitLab PURL with nested groups");
      assert.equal(components[0].name, "project", "should extract project name from URL");
      assert.equal(components[0].group, "group/subgroup", "should extract full group path from URL");
    });

    it("should handle plain https URLs without git+ prefix and .git suffix", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "plain-https-package",
        version: "https://github.com/owner/repository#v3.0.0",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:github/owner/repository@v3.0.0", "should handle plain https URL");
      assert.equal(components[0].name, "repository", "should extract repo name from URL");
      assert.equal(components[0].group, "owner", "should extract owner from URL");
    });

    it("should create proper PURL for GitHub URL without version tag", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "no-tag-package",
        version: "git+https://git@github.com/user/repo.git",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      // Per PURL spec, version can be empty for GitHub type when no specific commit/tag is referenced
      assert.equal(components[0].purl, "pkg:github/user/repo", "should have correct GitHub PURL without version");
      assert.equal(components[0].name, "repo", "should extract repo name from URL");
      assert.equal(components[0].group, "user", "should extract user from URL");
    });

    it("should handle scoped packages with GitHub URLs", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "@scope/package",
        version: "git+https://git@github.com/scope/package.git#v2.0.0",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      // Correctly single-encoded and extracts namespace from URL
      assert.equal(components[0].purl, "pkg:github/scope/package@v2.0.0", "should have GitHub PURL extracting scope/package from URL");
      assert.equal(components[0].name, "package", "should extract repo name from URL");
      assert.equal(components[0].group, "scope", "should extract org from URL");
    });

    it("should not modify regular npm versions", async () => {
      const { listComponents } = await import("./index.js");
      
      const pkg = {
        name: "regular-package",
        version: "1.2.3",
      };
      
      const components = listComponents({}, null, [pkg], "npm");
      
      assert.equal(components.length, 1, "should have 1 component");
      assert.equal(components[0].purl, "pkg:npm/regular-package@1.2.3", "should have correct npm PURL");
      assert.equal(components[0].name, "regular-package", "should have correct name");
      assert.deepStrictEqual(components[0].supplier, { name: "npm" }, "should set supplier to npm for regular npm packages");
    });
  });

  describe("BOM generation with SrcFile tracking", () => {
    it("should include SrcFile property for Go packages from go.sum", async () => {
      const mockGosumData = `google.golang.org/grpc v1.21.0/go.mod h1:oYelfM1adQP15Ek0mdvEgi9Df8B9CZIaU1084ijfRaM=`;
      
      const { parseGosumData } = await import("../helpers/utils.js");
      
      const result = await parseGosumData(mockGosumData, "/workspace/project/go.sum");
      
      assert.equal(result.length, 1, "should have 1 package");
      assert.equal(result[0].name, "google.golang.org/grpc", "should parse package name");
      assert.ok(result[0].properties, "should have properties array");
      assert.ok(
        result[0].properties.find(p => p.name === "SrcFile" && p.value === "/workspace/project/go.sum"),
        "should have SrcFile property with correct path"
      );
    });

    it("should include SrcFile property for Conan packages from conan.lock", async () => {
      const mockConanLockData = JSON.stringify({
        graph_lock: {
          nodes: {
            "0": {
              ref: "zlib/1.2.11"
            }
          }
        }
      });
      
      const { parseConanLockData } = await import("../helpers/utils.js");
      
      const result = parseConanLockData(mockConanLockData, "/workspace/project/conan.lock");
      
      assert.equal(result.pkgList.length, 1, "should have 1 package");
      assert.equal(result.pkgList[0].name, "zlib", "should parse package name");
      assert.ok(result.pkgList[0].properties, "should have properties array");
      assert.ok(
        result.pkgList[0].properties.find(p => p.name === "SrcFile" && p.value === "/workspace/project/conan.lock"),
        "should have SrcFile property with correct path"
      );
    });

    it("should include SrcFile property for Python packages from Pipfile.lock", async () => {
      const mockPiplockData = {
        default: {
          "requests": {
            version: "==2.28.0"
          }
        }
      };
      
      const { parsePiplockData } = await import("../helpers/utils.js");
      
      const result = await parsePiplockData(mockPiplockData, "/workspace/project/Pipfile.lock");
      
      assert.equal(result.length, 1, "should have 1 package");
      assert.equal(result[0].name, "requests", "should parse package name");
      assert.ok(result[0].properties, "should have properties array");
      assert.ok(
        result[0].properties.find(p => p.name === "SrcFile" && p.value === "/workspace/project/Pipfile.lock"),
        "should have SrcFile property with correct path"
      );
    });

    it("should use absolute paths in multi-project scenarios", async () => {
      const mockGosumData1 = `github.com/pkg/errors v0.9.1/go.mod h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEl0=`;
      const mockGosumData2 = `github.com/stretchr/testify v1.7.0/go.mod h1:6Fq8oRcR53rry900zMqJjRRixrwX3KX962/h/Wwjteg=`;
      
      const { parseGosumData } = await import("../helpers/utils.js");
      
      const result1 = await parseGosumData(mockGosumData1, "/workspace/project/backend/go.sum");
      const result2 = await parseGosumData(mockGosumData2, "/workspace/project/frontend/go.sum");
      
      assert.equal(result1[0].properties.find(p => p.name === "SrcFile").value, "/workspace/project/backend/go.sum");
      assert.equal(result2[0].properties.find(p => p.name === "SrcFile").value, "/workspace/project/frontend/go.sum");
      assert.notEqual(
        result1[0].properties.find(p => p.name === "SrcFile").value,
        result2[0].properties.find(p => p.name === "SrcFile").value,
        "should have distinct paths for different subprojects"
      );
    });
  });
});
