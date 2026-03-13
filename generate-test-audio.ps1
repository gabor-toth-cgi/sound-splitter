Add-Type -AssemblyName System.Speech

$baseDir = "C:\Projects\training\agentic\sound-splitter\input"

# =====================================================
# Sample 1: Two-speaker conversation with pauses
# (David and Zira alternating, simulating a meeting)
# =====================================================
Write-Output "Generating Sample 1: Two-speaker conversation..."
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$builder = New-Object System.Speech.Synthesis.PromptBuilder

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Good morning everyone. Let's start by reviewing the quarterly results.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(1.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Thanks David. Revenue was up twelve percent compared to last quarter. The new product line contributed about three million in additional sales.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(2.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("That's great news. What about the operating expenses?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(1.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Operating expenses increased by about five percent, mainly due to the new hires in engineering. However, the margin improvement still puts us ahead of target.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(3.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Excellent. Let's move on to the next agenda item. Sarah, can you give us an update on the customer satisfaction survey?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(1.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Sure. We received over two thousand responses this quarter. Overall satisfaction is at eighty seven percent, which is a three point increase from last quarter. The biggest improvement was in technical support, where we saw a ten point jump.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(2.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("That's really encouraging. Any areas that need attention?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.8))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Yes, delivery times are still a concern. About fifteen percent of respondents mentioned delays. We're working with the logistics team to address this.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(1.5))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Good. Let's make that a priority for the next quarter. Any other business before we wrap up?")
$builder.EndVoice()

$synth.SetOutputToWaveFile("$baseDir\sample1-meeting-conversation.wav")
$synth.Speak($builder)
$synth.Dispose()
Write-Output "  Done: sample1-meeting-conversation.wav"

# =====================================================
# Sample 2: Lecture/presentation with long monologue
# (Single speaker with natural pauses between topics)
# =====================================================
Write-Output "Generating Sample 2: Lecture presentation..."
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$builder = New-Object System.Speech.Synthesis.PromptBuilder

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Welcome to today's lecture on machine learning fundamentals. We'll be covering three main topics: supervised learning, unsupervised learning, and reinforcement learning.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(3.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Let's begin with supervised learning. In supervised learning, we have a dataset with labeled examples. The algorithm learns a mapping from inputs to outputs by analyzing these examples. Common algorithms include linear regression, decision trees, and neural networks.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(4.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Now, let's talk about unsupervised learning. Unlike supervised learning, we don't have labels. The algorithm must find structure in the data on its own. Clustering algorithms like k-means and hierarchical clustering are common examples. Dimensionality reduction techniques like PCA also fall into this category.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(5.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Finally, reinforcement learning. This is where an agent learns by interacting with an environment. The agent receives rewards or penalties based on its actions. Over time, it learns a policy that maximizes cumulative reward. Applications include game playing, robotics, and autonomous driving.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(2.0))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("That concludes today's overview. Are there any questions?")
$builder.EndVoice()

$synth.SetOutputToWaveFile("$baseDir\sample2-lecture-presentation.wav")
$synth.Speak($builder)
$synth.Dispose()
Write-Output "  Done: sample2-lecture-presentation.wav"

# =====================================================
# Sample 3: Quick back-and-forth dialog with short pauses
# (Simulating a rapid conversation / interview)
# =====================================================
Write-Output "Generating Sample 3: Rapid interview dialog..."
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$builder = New-Object System.Speech.Synthesis.PromptBuilder

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("So tell me about your experience with cloud computing.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.5))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("I've been working with AWS and Azure for about five years now.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Which services specifically?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.4))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Mainly EC2, Lambda, and S3 on the AWS side. For Azure, I've used App Service, Functions, and Cosmos DB.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.6))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Have you worked with Kubernetes?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Yes, both EKS and AKS. I set up a production cluster with auto scaling and CI CD pipelines.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("What about infrastructure as code?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.4))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Terraform is my go-to tool. I've also used CloudFormation and Pulumi depending on the project requirements.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.6))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("How do you handle monitoring and observability?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("We use Datadog for monitoring, PagerDuty for alerting, and the ELK stack for centralized logging. I also set up custom dashboards and SLOs for critical services.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("That's impressive. One last question. Where do you see cloud computing heading in the next five years?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.8))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("I think serverless will become the default deployment model for most applications. Edge computing will grow significantly. And AI services will be deeply integrated into every major cloud platform, making machine learning accessible to developers without specialized expertise.")
$builder.EndVoice()

$synth.SetOutputToWaveFile("$baseDir\sample3-interview-dialog.wav")
$synth.Speak($builder)
$synth.Dispose()
Write-Output "  Done: sample3-interview-dialog.wav"

# =====================================================
# Sample 4: Phone call style with one-sided conversation
# (Only hearing one side, with long listening pauses)
# =====================================================
Write-Output "Generating Sample 4: Phone call (one-sided)..."
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$builder = New-Object System.Speech.Synthesis.PromptBuilder

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Hello? Yes, this is Jennifer speaking.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(4.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Oh hi Mark, yes I got your email about the project deadline.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(6.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Right, I understand the client wants it by Friday. That's going to be tight but I think we can make it work if we prioritize the core features.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(5.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("No no, I already spoke with the design team. They said the mockups will be ready by Wednesday.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(3.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Exactly. So if we get the mockups Wednesday and start coding immediately, we should have the MVP by Thursday evening.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(7.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Well, we could cut the reporting module for now and add it in phase two. The client specifically asked for the dashboard and user management first anyway.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(4.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Okay great. I'll send you an updated timeline after lunch. Talk to you later. Bye.")
$builder.EndVoice()

$synth.SetOutputToWaveFile("$baseDir\sample4-phone-call.wav")
$synth.Speak($builder)
$synth.Dispose()
Write-Output "  Done: sample4-phone-call.wav"

# =====================================================
# Sample 5: Noisy environment / overlapping speech
# (Multiple interruptions and varied pacing)
# =====================================================
Write-Output "Generating Sample 5: Noisy meeting with interruptions..."
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$builder = New-Object System.Speech.Synthesis.PromptBuilder

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Okay so the main issue we're facing is the database migration.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.2))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Wait, are we talking about the PostgreSQL migration or the MongoDB one?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("The PostgreSQL one. The MongoDB migration was completed last week. So for Postgres, we need to handle about fifty million records and the downtime window is only four hours.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Four hours isn't enough. Last time we tried a similar migration it took six hours and that was with only thirty million records.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.2))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Right, but this time we're using logical replication so we can pre-sync most of the data beforehand.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.4))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Oh that changes things. So the four-hour window is just for the final cutover?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.2))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Exactly. We sync incrementally during the week, then on Saturday night we stop writes, catch up the last changes, switch the connection strings, and verify.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(1.0))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("What's our rollback plan if something goes wrong?")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("We keep the old database running in read-only mode. If we hit a critical issue, we just flip the connection strings back. The application is already designed to handle a brief read-only period.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.5))

$builder.StartVoice("Microsoft Zira Desktop")
$builder.AppendText("Sounds like a solid plan. Let's document this and share it with the operations team for review before we schedule the migration window.")
$builder.EndVoice()
$builder.AppendBreak([System.TimeSpan]::FromSeconds(0.3))

$builder.StartVoice("Microsoft David Desktop")
$builder.AppendText("Agreed. I'll write up the runbook today and share it by end of day.")
$builder.EndVoice()

$synth.SetOutputToWaveFile("$baseDir\sample5-noisy-meeting.wav")
$synth.Speak($builder)
$synth.Dispose()
Write-Output "  Done: sample5-noisy-meeting.wav"

Write-Output "`nAll 5 samples generated successfully!"
