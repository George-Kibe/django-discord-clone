from django.shortcuts import render, redirect
from django.http import HttpResponse

from .forms import PollForm
from .models import Poll
# Create your views here.


def home(request):
    polls = Poll.objects.all()
    context = {'polls': polls}
    return render(request, 'polls/home.html', context)


def create(request):
    if request.method == "POST":
        form = PollForm(request.POST)
        if form.is_valid():
            print(form.cleaned_data['question'])
            form.save()
            return redirect('polls:home')
    form = PollForm
    context = {'form': form}
    return render(request, 'polls/create.html', context)


def vote(request, poll_id):
    poll = Poll.objects.get(id=poll_id)
    if request.method == "POST":
        selected_option = request.POST['poll']
        print(selected_option)
        if selected_option == 'option1':
            poll.option_one_count += 1
        elif selected_option == 'option2':
            poll.option_two_count += 1
        elif selected_option == 'option3':
            poll.option_three_count += 1
        else:
            return HttpResponse(404, "Invalid Form")
        poll.save()
        return redirect('polls:results', poll.id)

    context = {'poll': poll}
    return render(request, 'polls/vote.html', context)


def results(request, poll_id):
    poll = Poll.objects.get(id=poll_id)
    context = {'poll': poll}
    return render(request, 'polls/results.html', context)
