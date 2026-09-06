class WhatsappController < ApplicationController
  skip_forgery_protection

  # POST /whatsapp/webhook (chamado pelo Node.js)
  def webhook
    data = request.params
    from = data['from']
    text = data['text']
    button_id = data['buttonId']

    client = WhatsappClient.new

    # Lógica do formulário (armazenada em memória, use Redis em produção)
    @sessions ||= {}

    if button_id == 'ativar'
      @sessions[from] = { step: 'aguardando_nome' }
      client.send_message(from, 'Qual é o seu nome completo?')
    
    elsif text.present?
      session = @sessions[from]
      
      if session.nil?
        client.send_message(from, 'Olá! Clique no botão "Ativar" para começar.', 
          buttons: [{ id: 'ativar', title: 'Ativar' }])
      
      elsif session[:step] == 'aguardando_nome'
        @sessions[from][:nome] = text
        @sessions[from][:step] = 'aguardando_email'
        client.send_message(from, "Obrigado, #{text}! Agora me diga seu e-mail:")

      elsif session[:step] == 'aguardando_email'
        nome = session[:nome]
        email = text

        # 💾 Salva no banco de dados aqui
        # Usuario.create(nome: nome, email: email)

        client.send_message(from, "✅ Pronto, #{nome}! Seu e-mail (#{email}) foi cadastrado com sucesso.")
        @sessions.delete(from)
      
      else
        client.send_message(from, 'Desculpe, não entendi. Use o botão "Ativar".')
      end
    end

    head :ok
  end
end
