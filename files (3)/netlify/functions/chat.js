// Netlify Function for secure DeepSeek API calls
const https = require('https');

// System prompt for English teaching
const SYSTEM_PROMPT = `You are a professional English AI teaching assistant. Users can only ask questions in English. Your tasks are:

1. Provide detailed, helpful English learning content (vocabulary, grammar, writing, pronunciation, etc.)
2. Give specific example sentences and usage scenarios
3. Provide complete Chinese translation
4. Use encouraging and educational tone
5. If asked about vocabulary meaning, provide definition, usage and examples
6. If asked about grammar, clearly explain rules with examples
7. If asked about writing, give structured guidance
8. Responses should be comprehensive but concise

Please reply in the following format:
[English response content with detailed explanations and examples]

Then add at the end:
<div class="translation">[Corresponding Chinese translation]</div>

Remember: Users can only ask questions in English, you must reply in both Chinese and English to help users learn English better! Focus on practicality and educational value.`;

exports.handler = async (event, context) => {
  console.log('=== DeepSeek API Function Called ===');
  console.log('HTTP Method:', event.httpMethod);
  console.log('Request Origin:', event.headers.origin || 'Unknown');
  
  // 处理 OPTIONS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  // 只允许POST请求
  if (event.httpMethod !== 'POST') {
    console.error('Invalid HTTP method:', event.httpMethod);
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        success: false,
        error: 'Method Not Allowed',
        message: 'Only POST requests are allowed'
      })
    };
  }

  try {
    console.log('Parsing request body...');
    
    // 检查是否有请求体
    if (!event.body) {
      console.error('No request body provided');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Request body is required' 
        })
      };
    }
    
    // 解析请求体
    let parsedBody;
    try {
      parsedBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Failed to parse JSON body:', parseError.message);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Invalid JSON format in request body' 
        })
      };
    }
    
    const { message } = parsedBody;
    console.log('Received message:', message ? `"${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"` : 'empty');
    console.log('Message length:', message ? message.length : 0);
    
    if (!message || message.trim() === '') {
      console.error('No message content provided');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Message content is required' 
        })
      };
    }

    // 从环境变量获取API密钥（安全！）
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      console.error('ERROR: DEEPSEEK_API_KEY environment variable is not set');
      console.error('Please set DEEPSEEK_API_KEY in Netlify environment variables');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: 'Server configuration error',
          message: 'API key is not configured. Please contact the administrator.'
        })
      };
    }

    console.log('✓ API Key found, length:', apiKey.length);
    console.log('Calling DeepSeek API...');
    
    // 调用DeepSeek API
    const deepseekResponse = await callDeepSeekAPI(apiKey, message);
    
    console.log('✓ DeepSeek API call successful');
    console.log('Response text length:', deepseekResponse.text.length);
    console.log('Response translation length:', deepseekResponse.translation.length);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify(deepseekResponse)
    };

  } catch (error) {
    console.error('=== Function Error Details ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    // 根据错误类型提供更友好的错误信息
    let userMessage = 'DeepSeek API call failed';
    let statusCode = 502;
    
    if (error.message.includes('401')) {
      userMessage = 'API密钥无效或已过期';
      statusCode = 401;
    } else if (error.message.includes('429')) {
      userMessage = 'API调用频率超限，请稍后再试';
      statusCode = 429;
    } else if (error.message.includes('timeout')) {
      userMessage = 'API请求超时，请重试';
      statusCode = 504;
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      userMessage = '无法连接到DeepSeek服务器，请检查网络连接';
      statusCode = 503;
    } else if (error.message.includes('Unexpected token')) {
      userMessage = 'DeepSeek服务器返回了无效的响应格式';
      statusCode = 502;
    }
    
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false,
        error: userMessage,
        details: error.message,
        help: 'Please check your API key and network connection'
      })
    };
  }
};

// 调用DeepSeek API的辅助函数
function callDeepSeekAPI(apiKey, userMessage) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      max_tokens: 1200,
      temperature: 0.7,
      stream: false,
      frequency_penalty: 0.3,
      presence_penalty: 0.3
    });

    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'English-Learning-App/1.0',
        'Accept': 'application/json'
      },
      timeout: 45000 // 45 秒超时
    };

    console.log('Making HTTPS request to DeepSeek API...');
    console.log('Request body size:', Buffer.byteLength(postData), 'bytes');
    console.log('Request headers:', JSON.stringify(options.headers, null, 2).replace(apiKey, '***REDACTED***'));

    const req = https.request(options, (res) => {
      console.log('DeepSeek API response status:', res.statusCode);
      console.log('DeepSeek API response headers:', res.headers);
      
      let data = '';
      let dataSize = 0;

      res.on('data', (chunk) => {
        data += chunk;
        dataSize += chunk.length;
      });

      res.on('end', () => {
        console.log('DeepSeek API response received');
        console.log('Response data size:', dataSize, 'bytes');
        console.log('Response data preview:', data.substring(0, 200) + (data.length > 200 ? '...' : ''));
        
        try {
          if (res.statusCode !== 200) {
            console.error('DeepSeek API returned error status:', res.statusCode);
            console.error('Error response:', data);
            
            let errorMsg = `DeepSeek API returned status ${res.statusCode}`;
            try {
              const errorJson = JSON.parse(data);
              if (errorJson.error && errorJson.error.message) {
                errorMsg = errorJson.error.message;
              }
            } catch (e) {
              // 如果不是JSON，使用原始数据
            }
            
            reject(new Error(`${errorMsg} (Status: ${res.statusCode})`));
            return;
          }
          
          const jsonData = JSON.parse(data);
          console.log('Successfully parsed DeepSeek response JSON');
          
          if (!jsonData.choices || !Array.isArray(jsonData.choices) || jsonData.choices.length === 0) {
            console.error('Invalid DeepSeek response format - missing choices:', jsonData);
            reject(new Error('Invalid response format from DeepSeek API: missing choices array'));
            return;
          }
          
          if (!jsonData.choices[0].message || !jsonData.choices[0].message.content) {
            console.error('Invalid DeepSeek response format - missing message content:', jsonData.choices[0]);
            reject(new Error('Invalid response format from DeepSeek API: missing message content'));
            return;
          }
          
          const aiContent = jsonData.choices[0].message.content;
          console.log('AI content extracted, length:', aiContent.length);
          
          // 分离英文和中文翻译
          let englishPart = aiContent;
          let chinesePart = "中文翻译未能正确提取，请查看英文回复内容。";
          
          // 方法1：查找翻译div
          const translationDivMatch = aiContent.match(/<div class="translation">([\s\S]*?)<\/div>/);
          if (translationDivMatch) {
            englishPart = aiContent.replace(translationDivMatch[0], '').trim();
            chinesePart = translationDivMatch[1].trim();
            console.log('✓ Translation extracted from div tag');
          } 
          // 方法2：查找其他翻译标记
          else if (aiContent.includes('翻译：') || aiContent.includes('Translation:')) {
            const lines = aiContent.split('\n');
            const translationIndex = lines.findIndex(line => 
              line.includes('翻译：') || line.includes('Translation:')
            );
            
            if (translationIndex !== -1) {
              englishPart = lines.slice(0, translationIndex).join('\n').trim();
              chinesePart = lines.slice(translationIndex).join('\n')
                .replace('翻译：', '')
                .replace('Translation:', '')
                .trim();
              console.log('✓ Translation extracted from text marker');
            }
          }
          // 方法3：简单分割
          else {
            const lines = aiContent.split('\n');
            if (lines.length > 2) {
              // 假设最后一段是中文翻译
              const lastLine = lines[lines.length - 1].trim();
              const secondLastLine = lines[lines.length - 2].trim();
              
              // 检查最后一行是否可能是中文（简单检查）
              const hasChinese = /[\u4e00-\u9fa5]/.test(lastLine);
              if (hasChinese && lastLine.length > 5) {
                englishPart = lines.slice(0, -1).join('\n').trim();
                chinesePart = lastLine;
                console.log('✓ Translation extracted from last line (Chinese detected)');
              } else {
                // 保留所有内容为英文，添加默认翻译
                englishPart = aiContent;
                chinesePart = "请参考上面的英文解释。如果需要更准确的中文翻译，请重新提问或联系管理员。";
                console.log('⚠ Using default translation');
              }
            }
          }
          
          // 清理空白字符
          englishPart = englishPart.trim();
          chinesePart = chinesePart.trim();
          
          // 确保英文部分不为空
          if (!englishPart || englishPart.length < 10) {
            englishPart = "I apologize, but I couldn't generate a proper response. Please try asking your question again or rephrase it.";
            chinesePart = "抱歉，我未能生成正确的回复。请重新提问或换一种方式表达您的问题。";
          }
          
          console.log('✓ English part length:', englishPart.length);
          console.log('✓ Chinese part length:', chinesePart.length);
          
          resolve({
            text: englishPart,
            translation: chinesePart,
            success: true,
            tokens: jsonData.usage || {}
          });
          
        } catch (parseError) {
          console.error('Failed to parse DeepSeek response:', parseError.message);
          console.error('Response data that failed to parse:', data.substring(0, 500));
          reject(new Error(`Failed to parse DeepSeek response: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('HTTPS request error:', error.message);
      console.error('Error code:', error.code);
      console.error('Error details:', error);
      
      if (error.code === 'ECONNREFUSED') {
        reject(new Error('无法连接到DeepSeek服务器，请检查网络连接 (ECONNREFUSED)'));
      } else if (error.code === 'ENOTFOUND') {
        reject(new Error('无法解析DeepSeek服务器地址，请检查网络设置 (ENOTFOUND)'));
      } else if (error.code === 'ETIMEDOUT') {
        reject(new Error('连接DeepSeek服务器超时，请稍后重试 (ETIMEDOUT)'));
      } else {
        reject(new Error(`HTTP request failed: ${error.message} (Code: ${error.code})`));
      }
    });

    req.on('timeout', () => {
      console.error('Request timeout after', options.timeout, 'ms');
      req.destroy();
      reject(new Error(`Request timeout - DeepSeek API did not respond in ${options.timeout}ms`));
    });

    req.on('close', () => {
      console.log('Request connection closed');
    });

    console.log('Sending request to DeepSeek API...');
    req.write(postData);
    req.end();
  });
}

// 导出用于测试
if (require.main === module) {
  // 本地测试代码
  console.log('Running local test...');
  
  // 模拟事件对象
  const testEvent = {
    httpMethod: 'POST',
    headers: {
      origin: 'http://localhost:8888'
    },
    body: JSON.stringify({
      message: 'How to use "it" in English?'
    })
  };
  
  const testContext = {};
  
  exports.handler(testEvent, testContext)
    .then(response => {
      console.log('Test response:', JSON.stringify(response, null, 2));
    })
    .catch(error => {
      console.error('Test error:', error);
    });
}