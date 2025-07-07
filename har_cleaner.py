#!/usr/bin/env python3
"""
HAR file cleaner to extract only interesting API calls and MCP interactions.
"""

import json
import re
from typing import Dict, List, Any

def is_interesting_url(url: str) -> bool:
    """Determine if a URL is interesting for our analysis."""
    interesting_patterns = [
        r'rtm-mcp-server\.vcto-6e7\.workers\.dev',  # RTM MCP server
        r'anthropic\.com',  # Anthropic API calls
        r'/api/.*/chat',    # Chat conversations
        r'/api/.*/mcp/',    # MCP related API calls
        r'wss://.*mcp',     # MCP WebSocket connections
    ]
    
    # Skip noise - everything else
    noise_patterns = [
        r'\.js$', r'\.css$', r'\.png$', r'\.jpg$', r'\.ico$',
        r'/_next/', r'/static/', r'/assets/',
        r'intercom\.io', r'amplitude\.com', r'google', r'gtag',
        r'fonts\.googleapis\.com', r'wix', r'SearchWix'
    ]
    
    for pattern in noise_patterns:
        if re.search(pattern, url, re.IGNORECASE):
            return False
    
    for pattern in interesting_patterns:
        if re.search(pattern, url, re.IGNORECASE):
            return True
    
    return False

def extract_interesting_content(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Extract interesting content from a HAR entry."""
    cleaned_entry = {
        'url': entry['request']['url'],
        'method': entry['request']['method'],
        'status': entry['response']['status'],
        'startedDateTime': entry['startedDateTime']
    }
    
    # Add request content if available and interesting
    if 'postData' in entry['request'] and 'text' in entry['request']['postData']:
        try:
            post_data = json.loads(entry['request']['postData']['text'])
            cleaned_entry['requestBody'] = post_data
        except json.JSONDecodeError:
            cleaned_entry['requestBody'] = entry['request']['postData']['text']
    
    # Add response content if available and interesting
    if 'content' in entry['response'] and 'text' in entry['response']['content']:
        response_text = entry['response']['content']['text']
        if response_text:
            try:
                response_data = json.loads(response_text)
                cleaned_entry['responseBody'] = response_data
            except json.JSONDecodeError:
                # Keep raw text if it's not too long
                if len(response_text) < 10000:
                    cleaned_entry['responseBody'] = response_text
    
    # Add WebSocket messages if present
    if '_webSocketMessages' in entry:
        messages = []
        for msg in entry['_webSocketMessages']:
            try:
                if 'data' in msg:
                    data = json.loads(msg['data'])
                    messages.append({
                        'type': msg.get('type', 'unknown'),
                        'time': msg.get('time', ''),
                        'data': data
                    })
            except json.JSONDecodeError:
                messages.append({
                    'type': msg.get('type', 'unknown'),
                    'time': msg.get('time', ''),
                    'data': msg.get('data', '')
                })
        
        if messages:
            cleaned_entry['webSocketMessages'] = messages
    
    return cleaned_entry

def clean_har_file(input_path: str, output_path: str):
    """Clean the HAR file and save interesting content."""
    with open(input_path, 'r') as f:
        har_data = json.load(f)
    
    cleaned_entries = []
    
    for entry in har_data['log']['entries']:
        url = entry['request']['url']
        
        if is_interesting_url(url):
            cleaned_entry = extract_interesting_content(entry)
            cleaned_entries.append(cleaned_entry)
    
    # Create cleaned HAR structure
    cleaned_har = {
        'version': '1.0',
        'creator': 'HAR Cleaner',
        'description': 'Cleaned HAR file containing only interesting API calls and MCP interactions',
        'entries': cleaned_entries,
        'summary': {
            'total_entries': len(cleaned_entries),
            'original_entries': len(har_data['log']['entries']),
            'reduction_ratio': f"{(1 - len(cleaned_entries) / len(har_data['log']['entries'])) * 100:.1f}%"
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(cleaned_har, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Cleaned HAR file saved to: {output_path}")
    print(f"📊 Reduced from {len(har_data['log']['entries'])} to {len(cleaned_entries)} entries")
    print(f"🗜️  Reduction: {cleaned_har['summary']['reduction_ratio']}")

if __name__ == "__main__":
    input_file = "/Users/vcto/Downloads/claude.ai.har"
    output_file = "/Users/vcto/cowflare/claude_cleaned.json"
    
    clean_har_file(input_file, output_file)
