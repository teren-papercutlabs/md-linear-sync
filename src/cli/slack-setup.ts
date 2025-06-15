import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import clipboardy from 'clipboardy';

const execAsync = promisify(exec);

export async function setupSlackCommand(): Promise<void> {
  console.log('🔧 Setting up Slack notifications\n');
  
  await setupSlackApp();
}

async function setupSlackApp(): Promise<void> {
  console.log('This is the md-linear-sync Slack notification system setup wizard\n');
  console.log('Step 1: We need to create a Slack app to process the notifications\n');
  
  console.log('After pressing Enter:');
  console.log('• Manifest will be copied to clipboard');
  console.log('• Slack page will open');
  console.log('• Select "From an app manifest"');
  console.log('• Choose your workspace');
  console.log('• Paste the manifest and create the app');
  console.log('• Install the app to your workspace\n');
  
  console.log('Press Enter to begin...');
  await getInput('');

  // Read the manifest file
  const manifestPath = path.join(__dirname, '../../slack-app-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Copy manifest to clipboard
  try {
    await clipboardy.write(JSON.stringify(manifest, null, 2));
    console.log('📋 Manifest copied to clipboard!');
  } catch (error) {
    console.log('⚠️  Could not copy to clipboard, here\'s the manifest:\n');
    console.log(JSON.stringify(manifest, null, 2));
    console.log('\n📋 Copy the above JSON');
  }

  // Open Slack apps page (non-blocking)
  openURL('https://api.slack.com/apps?new_app=1').catch(() => {});
  console.log('🌐 Opening Slack app creation page...');
  console.log('🔗 Go here if page didn\'t open: https://api.slack.com/apps?new_app=1');
  
  console.log('\nInstructions:');
  console.log('1. Select "From an app manifest"');
  console.log('2. Choose your workspace');
  console.log('3. Paste the manifest (Cmd+V / Ctrl+V)');
  console.log('4. Create the app');
  console.log('5. Install the app to your workspace');
  
  console.log('\nPress Enter once Slack app is created...');
  await getInput('');
  
  console.log('🔑 Now we need the Bot User OAuth Token');
  console.log('   Go to "OAuth & Permissions" → Install to Workspace → Copy the token starting with "xoxb-"');
  
  const botToken = await getInput('Bot User OAuth Token: ');
  
  if (!botToken.startsWith('xoxb-')) {
    console.log('❌ That doesn\'t look like a valid bot token');
    console.log('   It should start with: xoxb-');
    return;
  }

  // Update .env file
  await updateEnvFile('SLACK_BOT_TOKEN', botToken);
  
  // Auto-create notification channel
  console.log('\n📺 Creating notification channel...');
  const channelName = 'md-linear-sync-notifications';
  
  try {
    const channelId = await createSlackChannel(botToken, channelName);
    console.log(`✅ Created #${channelName} channel`);
    
    // Invite bot to the channel
    if (channelId) {
      await inviteBotToChannel(botToken, channelId);
      console.log(`🤖 Bot invited to #${channelName}`);
    }
    
    // Get team info for URL
    const teamInfo = await getTeamInfo(botToken);
    if (teamInfo && channelId) {
      const channelUrl = `https://${teamInfo.domain}.slack.com/channels/${channelId}`;
      console.log(`🔗 Join the channel: ${channelUrl}`);
    }
  } catch (error) {
    console.log(`⚠️  Could not create channel: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.log('   You can manually invite the bot to any channel you want to use');
  }
  
  // Test the bot
  await testSlackBot(botToken, channelName);
  
  console.log('\n🎉 Slack setup complete!');
  console.log(`💡 Notifications will be sent to #${channelName}`);
  
  // Ensure process exits cleanly
  process.exit(0);
}

async function updateEnvFile(key: string, value: string): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  
  // Read existing .env file if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }
  
  // Check if key already exists
  const lines = envContent.split('\n');
  const keyIndex = lines.findIndex(line => line.startsWith(`${key}=`));
  
  if (keyIndex >= 0) {
    // Update existing key
    lines[keyIndex] = `${key}=${value}`;
  } else {
    // Add new key
    lines.push(`${key}=${value}`);
  }
  
  // Write back to file
  fs.writeFileSync(envPath, lines.filter(line => line.trim()).join('\n') + '\n');
  console.log(`✅ Updated .env file with ${key}`);
}


async function getTeamInfo(botToken: string): Promise<{ domain: string } | null> {
  try {
    const response = await fetch('https://slack.com/api/team.info', {
      headers: { 'Authorization': `Bearer ${botToken}` }
    });
    const result = await response.json();
    return result.ok ? { domain: result.team.domain } : null;
  } catch (error) {
    return null;
  }
}

async function inviteBotToChannel(botToken: string, channelId: string): Promise<void> {
  const response = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      channel: channelId
    })
  });
  
  const result = await response.json();
  if (!result.ok && result.error !== 'already_in_channel') {
    throw new Error(result.error);
  }
}

async function createSlackChannel(botToken: string, channelName: string): Promise<string> {
  const response = await fetch('https://slack.com/api/conversations.create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: channelName,
      is_private: false
    })
  });
  
  const result = await response.json();
  
  if (!result.ok) {
    if (result.error === 'name_taken') {
      console.log(`✅ Channel #${channelName} already exists`);
      // Get existing channel info
      const infoResponse = await fetch(`https://slack.com/api/conversations.list?types=public_channel&limit=200`, {
        headers: { 'Authorization': `Bearer ${botToken}` }
      });
      const infoResult = await infoResponse.json();
      const existingChannel = infoResult.channels?.find((ch: any) => ch.name === channelName);
      return existingChannel?.id || '';
    }
    throw new Error(result.error);
  }
  
  return result.channel.id;
}

async function testSlackBot(botToken: string, channel: string): Promise<void> {
  console.log('\n🧪 Testing bot token...');
  
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: channel.replace('#', ''),
        text: '🎉 Linear Markdown Sync bot is now connected!'
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Test message sent successfully!');
      console.log('📱 Check your Slack channel for the test message');
    } else {
      console.log('❌ Test failed:', result.error);
      if (result.error === 'channel_not_found') {
        console.log('💡 Make sure the bot is invited to the channel');
      }
    }
  } catch (error) {
    console.log('❌ Test failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}

// Utility functions
async function getUserChoice(maxChoice: number): Promise<number> {
  while (true) {
    const choice = await getInput(`Enter your choice (1-${maxChoice}): `);
    const num = parseInt(choice.trim());
    if (num >= 1 && num <= maxChoice) {
      return num;
    }
    console.log(`Please enter a number between 1 and ${maxChoice}`);
  }
}

async function getInput(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
}

async function openURL(url: string): Promise<void> {
  const platform = process.platform;
  let command = '';
  
  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  
  await execAsync(command);
}

