namespace MapleNotes.Server.Tests.Hosting;

/// <summary>The README shows the deployment files in full; these tests keep those copies identical to the real files.</summary>
public sealed class DocumentationTests
{
    [Theory]
    [InlineData("docker-compose.yml")]
    [InlineData(".env.example")]
    [InlineData("deploy/portainer-stack.yml")]
    [InlineData("deploy/portainer-stack-https.yml")]
    [InlineData("deploy/portainer-stack-npm.yml")]
    [InlineData("deploy/nginx-proxy-manager.conf")]
    public void The_readme_shows_the_current_file(string file)
    {
        var root = RepositoryRoot();
        var readme = File.ReadAllText(Path.Combine(root, "README.md")).ReplaceLineEndings("\n");
        var content = File.ReadAllText(Path.Combine(root, file)).ReplaceLineEndings("\n").TrimEnd('\n');

        Assert.Contains("\n" + content + "\n```", readme, StringComparison.Ordinal);
    }

    private static string RepositoryRoot()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "MapleNotes.slnx")))
        {
            root = root.Parent;
        }

        return root!.FullName;
    }
}
